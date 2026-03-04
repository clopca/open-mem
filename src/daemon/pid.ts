import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface PidLivenessStatus {
	state: "alive" | "missing" | "dead";
	pid: number | null;
	stalePid: number | null;
	stalePidRemoved: boolean;
}

export type PlatformWorkerProcessKind = "claude" | "cursor";

export type KnownProcessType = "daemon" | "platform-worker-claude" | "platform-worker-cursor";

export interface KnownProcessPidFile {
	type: KnownProcessType;
	pidPath: string;
}

/** Write the current process PID to the given file path. */
export function writePid(pidPath: string): void {
	const lastSlash = pidPath.lastIndexOf("/");
	if (lastSlash > 0) {
		const dir = pidPath.substring(0, lastSlash);
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(pidPath, String(process.pid), "utf-8");
}

/** Read a PID from file, returning null if missing or invalid. */
export function readPid(pidPath: string): number | null {
	if (!existsSync(pidPath)) {
		return null;
	}
	const content = readFileSync(pidPath, "utf-8").trim();
	const pid = Number.parseInt(content, 10);
	if (Number.isNaN(pid)) {
		return null;
	}
	return pid;
}

/** Check whether a process with the given PID is still running. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		// EPERM means the process exists but we lack permission to signal it
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EPERM") {
			return true;
		}
		return false; // ESRCH or other → process does not exist
	}
}

/** Resolve process liveness from a PID file with optional stale cleanup. */
export function getPidLiveness(pidPath: string, removeStale: boolean): PidLivenessStatus {
	const pid = readPid(pidPath);
	if (pid === null) {
		return { state: "missing", pid: null, stalePid: null, stalePidRemoved: false };
	}
	if (isProcessAlive(pid)) {
		return { state: "alive", pid, stalePid: null, stalePidRemoved: false };
	}
	if (!removeStale) {
		return { state: "dead", pid: null, stalePid: pid, stalePidRemoved: false };
	}
	let stalePidRemoved = false;
	if (existsSync(pidPath)) {
		removePid(pidPath);
		stalePidRemoved = !existsSync(pidPath);
	}
	return { state: "dead", pid: null, stalePid: pid, stalePidRemoved };
}

/** Remove a PID file, ignoring errors if it doesn't exist. */
export function removePid(pidPath: string): void {
	try {
		unlinkSync(pidPath);
	} catch {
		// file may not exist
	}
}

/** Derive the PID file path from the database path. */
export function getPidPath(dbPath: string): string {
	const lastSlash = dbPath.lastIndexOf("/");
	if (lastSlash >= 0) {
		return `${dbPath.substring(0, lastSlash)}/worker.pid`;
	}
	return "worker.pid";
}

/** Derive the platform worker PID path from the database path and worker kind. */
export function getPlatformWorkerPidPath(dbPath: string, kind: PlatformWorkerProcessKind): string {
	const lastSlash = dbPath.lastIndexOf("/");
	const pidDir = lastSlash >= 0 ? dbPath.substring(0, lastSlash) : ".";
	return `${pidDir}/platform-worker-${kind}.pid`;
}

/** Derive known process PID files associated with the database path. */
export function getKnownProcessPidFiles(dbPath: string): KnownProcessPidFile[] {
	return [
		{ type: "daemon", pidPath: getPidPath(dbPath) },
		{ type: "platform-worker-claude", pidPath: getPlatformWorkerPidPath(dbPath, "claude") },
		{ type: "platform-worker-cursor", pidPath: getPlatformWorkerPidPath(dbPath, "cursor") },
	];
}
