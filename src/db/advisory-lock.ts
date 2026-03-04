import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { isProcessAlive } from "../daemon/pid";

export type ProcessRole =
	| "plugin"
	| "daemon"
	| "platform-worker-claude"
	| "platform-worker-cursor"
	| "maintenance";

export const DEFAULT_WRITE_LOCK_ROLE: ProcessRole = "plugin";

interface LockOwnerMetadata {
	pid: number;
	role: ProcessRole;
	hostname: string;
	acquiredAt: string;
	ownerId?: string;
}

interface ReentrantLockState {
	count: number;
	fd: number;
}

export interface WriteLockHandle {
	lockPath: string;
	role: ProcessRole;
	waitDurationMs: number;
	reentrant: boolean;
	release: () => void;
}

export interface AcquireWriteLockOptions {
	role: ProcessRole;
	timeoutMs?: number;
	retryIntervalMs?: number;
	ownerId?: string;
	now?: () => number;
}

export class AdvisoryLockTimeoutError extends Error {
	public readonly lockPath: string;
	public readonly role: ProcessRole;
	public readonly waitDurationMs: number;
	public readonly owner: LockOwnerMetadata | null;

	constructor(params: {
		lockPath: string;
		role: ProcessRole;
		waitDurationMs: number;
		owner: LockOwnerMetadata | null;
	}) {
		super(
			`Timed out acquiring advisory write lock after ${params.waitDurationMs}ms (role=${params.role}, lockPath=${params.lockPath})`,
		);
		this.name = "AdvisoryLockTimeoutError";
		this.lockPath = params.lockPath;
		this.role = params.role;
		this.waitDurationMs = params.waitDurationMs;
		this.owner = params.owner;
	}
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_RETRY_INTERVAL_MS = 50;
const inProcessReentrantLocks = new Map<string, ReentrantLockState>();

function sleepSync(ms: number): void {
	if (ms <= 0) return;
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
}

function readOwnerMetadata(lockPath: string): LockOwnerMetadata | null {
	try {
		const raw = readFileSync(lockPath, "utf8").trim();
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as { pid?: unknown }).pid !== "number" ||
			typeof (parsed as { role?: unknown }).role !== "string" ||
			typeof (parsed as { hostname?: unknown }).hostname !== "string" ||
			typeof (parsed as { acquiredAt?: unknown }).acquiredAt !== "string"
		) {
			return null;
		}

		return {
			pid: (parsed as { pid: number }).pid,
			role: (parsed as { role: ProcessRole }).role,
			hostname: (parsed as { hostname: string }).hostname,
			acquiredAt: (parsed as { acquiredAt: string }).acquiredAt,
			ownerId:
				typeof (parsed as { ownerId?: unknown }).ownerId === "string"
					? (parsed as { ownerId: string }).ownerId
					: undefined,
		};
	} catch {
		return null;
	}
}


function sameOwner(a: LockOwnerMetadata | null, b: LockOwnerMetadata | null): boolean {
	if (!a || !b) return false;
	return (
		a.pid === b.pid &&
		a.role === b.role &&
		a.hostname === b.hostname &&
		a.acquiredAt === b.acquiredAt &&
		a.ownerId === b.ownerId
	);
}

function tryReapStaleLock(lockPath: string, owner: LockOwnerMetadata | null): boolean {
	if (!owner) return false;
	if (owner.hostname !== hostname()) return false;
	if (isProcessAlive(owner.pid)) return false;

	// Re-read owner metadata before deletion to avoid deleting a lock that was
	// replaced between reads.
	const currentOwner = readOwnerMetadata(lockPath);
	if (!sameOwner(currentOwner, owner)) return false;

	try {
		unlinkSync(lockPath);
		return true;
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ENOENT") return false;
		throw error;
	}
}

function releaseLockPath(lockPath: string, fd: number): void {
	closeSync(fd);
	try {
		unlinkSync(lockPath);
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code !== "ENOENT") {
			throw error;
		}
	}
}

export function getAdvisoryWriteLockPath(dbPath: string): string {
	return `${dbPath}.write.lock`;
}

export function acquireWriteLock(
	lockPath: string,
	options: AcquireWriteLockOptions,
): WriteLockHandle {
	const now = options.now ?? Date.now;
	const timeoutMs = normalizePositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
	const retryIntervalMs = normalizePositiveInt(options.retryIntervalMs, DEFAULT_RETRY_INTERVAL_MS);

	const reentrant = inProcessReentrantLocks.get(lockPath);
	if (reentrant) {
		reentrant.count += 1;
		let released = false;
		return {
			lockPath,
			role: options.role,
			waitDurationMs: 0,
			reentrant: true,
			release: () => {
				if (released) return;
				released = true;
				const state = inProcessReentrantLocks.get(lockPath);
				if (!state) return;
				state.count -= 1;
				if (state.count === 0) {
					inProcessReentrantLocks.delete(lockPath);
					releaseLockPath(lockPath, state.fd);
				}
			},
		};
	}

	const owner: LockOwnerMetadata = {
		pid: process.pid,
		role: options.role,
		hostname: hostname(),
		acquiredAt: new Date(now()).toISOString(),
		ownerId: options.ownerId,
	};

	const startedAt = now();
	let observedOwner: LockOwnerMetadata | null = null;

	for (;;) {
		try {
			const fd = openSync(lockPath, "wx");
			try {
				writeFileSync(lockPath, JSON.stringify(owner), "utf8");
			} catch (writeError) {
				releaseLockPath(lockPath, fd);
				throw writeError;
			}
			inProcessReentrantLocks.set(lockPath, { count: 1, fd });

			let released = false;
			return {
				lockPath,
				role: options.role,
				waitDurationMs: now() - startedAt,
				reentrant: false,
				release: () => {
					if (released) return;
					released = true;
					const state = inProcessReentrantLocks.get(lockPath);
					if (!state) return;
					state.count -= 1;
					if (state.count === 0) {
						inProcessReentrantLocks.delete(lockPath);
						releaseLockPath(lockPath, state.fd);
					}
				},
			};
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code !== "EEXIST") {
				throw error;
			}

			observedOwner = readOwnerMetadata(lockPath);
			if (tryReapStaleLock(lockPath, observedOwner)) {
				continue;
			}
			const elapsedMs = now() - startedAt;
			if (elapsedMs >= timeoutMs) {
				throw new AdvisoryLockTimeoutError({
					lockPath,
					role: options.role,
					waitDurationMs: elapsedMs,
					owner: observedOwner,
				});
			}

			sleepSync(Math.min(retryIntervalMs, timeoutMs - elapsedMs));
		}
	}
}

export function withWriteLock<T>(
	lockPath: string,
	options: AcquireWriteLockOptions,
	operation: () => T,
): T {
	const lock = acquireWriteLock(lockPath, options);
	try {
		return operation();
	} finally {
		lock.release();
	}
}
