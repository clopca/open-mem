import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonManager, getMaintenancePreflightStatus } from "../../src/daemon/manager";
import { getPidPath, getPlatformWorkerPidPath } from "../../src/daemon/pid";
import { createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import plugin from "../../src/index";
import { QueueProcessor } from "../../src/queue/processor";

const tempDirs: string[] = [];
const tempPids: number[] = [];

function createTempProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "open-mem-platform-"));
	tempDirs.push(dir);
	return dir;
}

async function runWorker(
	entry: "claude-code" | "cursor",
	project: string,
	lines: string[],
	envOverrides: Record<string, string> = {},
): Promise<
	Array<{
		ok: boolean;
		code: string;
		message?: string;
		status?: Record<string, unknown>;
		processed?: number;
	}>
> {
	const proc = Bun.spawn([process.execPath, "run", `src/${entry}.ts`, "--project", project], {
		cwd: join(import.meta.dir, "../.."),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPEN_MEM_COMPRESSION: "false",
			OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
			OPEN_MEM_PLATFORM_CURSOR: "true",
			...envOverrides,
		},
	});
	tempPids.push(proc.pid);

	proc.stdin.write(`${lines.join("\n")}\n`);
	proc.stdin.end();

	return readWorkerResponses(entry, proc);
}

async function readWorkerResponses(
	entry: "claude-code" | "cursor",
	proc: {
		stdout: ReadableStream<Uint8Array>;
		stderr: ReadableStream<Uint8Array>;
		exited: Promise<number>;
	},
): Promise<
	Array<{
		ok: boolean;
		code: string;
		message?: string;
		status?: Record<string, unknown>;
		processed?: number;
	}>
> {
	const stdout = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`worker failed (${entry}): ${stderr}`);
	}
	return stdout
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.flatMap((line) => {
			try {
				return [
					JSON.parse(line) as {
						ok: boolean;
						code: string;
						message?: string;
						status?: Record<string, unknown>;
						processed?: number;
					},
				];
			} catch {
				return [];
			}
		});
}

async function waitForProcessExit(pid: number, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			process.kill(pid, 0);
			await Bun.sleep(25);
		} catch {
			return;
		}
	}
	throw new Error(`timed out waiting for process exit: ${pid}`);
}

function readProject(project: string) {
	const db = createDatabase(join(project, ".open-mem", "memory.db"));
	initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
	const observations = new ObservationRepository(db);
	const pending = new PendingMessageRepository(db);
	const sessions = new SessionRepository(db);
	const session = sessions.getById("sess-1");
	const items = observations.getBySession("sess-1");
	const pendingItems = pending.getPending(100);
	db.close();
	return { session, items, pendingItems };
}

async function waitForFile(path: string, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (existsSync(path)) return;
		await Bun.sleep(25);
	}
	throw new Error(`timed out waiting for file: ${path}`);
}

async function waitForFileRemoval(path: string, timeoutMs = 1000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (!existsSync(path)) return;
		await Bun.sleep(25);
	}
	throw new Error(`timed out waiting for file removal: ${path}`);
}

async function assertWorkerPidLifecycle(entry: "claude-code" | "cursor"): Promise<void> {
	const project = createTempProject();
	const dbPath = join(project, ".open-mem", "memory.db");
	const pidPath = getPlatformWorkerPidPath(dbPath, entry === "claude-code" ? "claude" : "cursor");
	const proc = Bun.spawn([process.execPath, "run", `src/${entry}.ts`, "--project", project], {
		cwd: join(import.meta.dir, "../.."),
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPEN_MEM_COMPRESSION: "false",
			OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
			OPEN_MEM_PLATFORM_CURSOR: "true",
		},
	});
	tempPids.push(proc.pid);

	await waitForFile(pidPath, 2000);
	expect(existsSync(pidPath)).toBe(true);

	proc.stdin.write(`${JSON.stringify({ command: "shutdown" })}\n`);
	proc.stdin.end();

	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`worker failed (${entry}): ${stderr}`);
	}

	await waitForFileRemoval(pidPath, 2000);
	expect(existsSync(pidPath)).toBe(false);
}

async function createSignalTrapProcess(
	project: string,
	options: { exitOnSignal?: boolean } = {},
): Promise<{ pid: number; signalPath: string }> {
	const { exitOnSignal = false } = options;
	const signalPath = join(project, "signal-observed.txt");
	const readyPath = join(project, "signal-ready.txt");
	const script = `
import { writeFileSync } from "node:fs";
process.on("SIGUSR1", () => {
  writeFileSync(${JSON.stringify(signalPath)}, String(Date.now()), "utf8");
  if (${JSON.stringify(exitOnSignal)}) process.exit(0);
});
writeFileSync(${JSON.stringify(readyPath)}, "ready", "utf8");
setInterval(() => {}, 1000);
`;
	const proc = Bun.spawn([process.execPath, "--eval", script], {
		stdout: "ignore",
		stderr: "pipe",
	});
	tempPids.push(proc.pid);
	await waitForFile(readyPath, 2000);
	return { pid: proc.pid, signalPath };
}

describe("platform workers", () => {
	afterEach(() => {
		for (const pid of tempPids.splice(0)) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// already exited
			}
		}
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("claude-code worker ingests JSON events", async () => {
		const project = createTempProject();
		const responses = await runWorker("claude-code", project, [
			JSON.stringify({ type: "session.start", sessionId: "sess-1" }),
			JSON.stringify({
				type: "tool.execute",
				sessionId: "sess-1",
				callId: "call-1",
				toolName: "Read",
				output:
					"Read src/index.ts and found platform ingestion wiring plus lifecycle hooks for worker adapters.",
			}),
			JSON.stringify({
				type: "chat.message",
				sessionId: "sess-1",
				role: "user",
				text: "Ensure platform adapter behavior is equivalent across all surfaces.",
			}),
			JSON.stringify({ type: "idle.flush", sessionId: "sess-1" }),
			JSON.stringify({ type: "session.end", sessionId: "sess-1" }),
		]);
		expect(responses.length).toBe(5);
		expect(responses.every((r) => r.ok)).toBe(true);

		const { session, items } = readProject(project);
		expect(session?.status).toBe("completed");
		expect(items.length).toBeGreaterThanOrEqual(2);
	});

	test("cursor worker ingests cursor-style events", async () => {
		const project = createTempProject();
		const responses = await runWorker("cursor", project, [
			JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
			JSON.stringify({
				eventName: "toolExecute",
				session: "sess-1",
				invocationId: "call-1",
				tool: "Read",
				output:
					"Read src/index.ts and found platform ingestion wiring plus lifecycle hooks for worker adapters.",
			}),
			JSON.stringify({
				eventName: "chatMessage",
				session: "sess-1",
				role: "user",
				message: "Ensure platform adapter behavior is equivalent across all surfaces.",
			}),
			JSON.stringify({ eventName: "idleFlush", session: "sess-1" }),
			JSON.stringify({ eventName: "sessionEnd", session: "sess-1" }),
		]);
		expect(responses.length).toBe(5);
		expect(responses.every((r) => r.ok)).toBe(true);

		const { session, items } = readProject(project);
		expect(session?.status).toBe("completed");
		expect(items.length).toBeGreaterThanOrEqual(2);
	});

	test("worker emits structured error response for invalid JSON", async () => {
		const project = createTempProject();
		const responses = await runWorker("cursor", project, [
			"not-json",
			JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
		]);
		expect(responses[0].ok).toBe(false);
		expect(responses[0].code).toBe("INVALID_JSON");
		expect(responses[1].ok).toBe(true);
	});

	test("worker uses enqueue-only mode when daemon is healthy", async () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		const pidPath = getPidPath(dbPath);
		const trap = await createSignalTrapProcess(project);
		const db = createDatabase(dbPath);
		initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
		db.close();
		writeFileSync(pidPath, String(trap.pid), "utf-8");

		const responses = await runWorker(
			"claude-code",
			project,
			[
				JSON.stringify({ type: "session.start", sessionId: "sess-1" }),
				JSON.stringify({
					type: "tool.execute",
					sessionId: "sess-1",
					callId: "call-1",
					toolName: "Read",
					output:
						"Read src/platform-worker.ts and confirmed enqueue-only mode should skip local batch processing.",
				}),
				JSON.stringify({ command: "flush" }),
				JSON.stringify({ command: "health" }),
			],
			{ OPEN_MEM_DAEMON: "true" },
		);

		const flush = responses.find((resp) => resp.code === "ENQUEUED");
		expect(flush?.ok).toBe(true);
		expect(flush?.processed).toBeUndefined();
		expect(flush?.message).toContain("asynchronous");
		const health = responses.find((resp) => resp.status);
		expect(health?.status?.queue).toBeDefined();
		expect((health?.status?.queue as Record<string, unknown>)?.mode).toBe("enqueue-only");

		const { items, pendingItems } = readProject(project);
		expect(items.length).toBe(0);
		expect(pendingItems.length).toBeGreaterThanOrEqual(1);
	});

	test("worker signals daemon when enqueue-only mode receives events", async () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		const pidPath = getPidPath(dbPath);
		const trap = await createSignalTrapProcess(project);
		const db = createDatabase(dbPath);
		initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
		db.close();
		writeFileSync(pidPath, String(trap.pid), "utf-8");

		await runWorker(
			"cursor",
			project,
			[
				JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
				JSON.stringify({
					eventName: "toolExecute",
					session: "sess-1",
					invocationId: "call-1",
					tool: "Read",
					output: "Read src/daemon/manager.ts and confirmed SIGUSR1 handoff behavior.",
				}),
			],
			{ OPEN_MEM_DAEMON: "true" },
		);

		await waitForFile(trap.signalPath, 2000);
		expect(existsSync(trap.signalPath)).toBe(true);
	});

	test("worker falls back to in-process mode when daemon signal fails after startup", async () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		const pidPath = getPidPath(dbPath);
		const trap = await createSignalTrapProcess(project, { exitOnSignal: true });
		const db = createDatabase(dbPath);
		initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
		db.close();
		writeFileSync(pidPath, String(trap.pid), "utf-8");

		const proc = Bun.spawn([process.execPath, "run", "src/claude-code.ts", "--project", project], {
			cwd: join(import.meta.dir, "../.."),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				OPEN_MEM_COMPRESSION: "false",
				OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
				OPEN_MEM_PLATFORM_CURSOR: "true",
				OPEN_MEM_DAEMON: "true",
			},
		});
		tempPids.push(proc.pid);

		proc.stdin.write(`${JSON.stringify({ type: "session.start", sessionId: "sess-1" })}\n`);
		proc.stdin.write(
			`${JSON.stringify({
				type: "tool.execute",
				sessionId: "sess-1",
				callId: "call-1",
				toolName: "Read",
				output: "Read src/daemon/manager.ts and validated PROCESS_NOW fallback semantics.",
			})}\n`,
		);
		await waitForFile(trap.signalPath, 2000);
		await waitForProcessExit(trap.pid, 2000);

		proc.stdin.write(`${JSON.stringify({ command: "flush" })}\n`);
		proc.stdin.write(`${JSON.stringify({ command: "health" })}\n`);
		proc.stdin.write(`${JSON.stringify({ command: "shutdown" })}\n`);
		proc.stdin.end();

		const responses = await readWorkerResponses("claude-code", proc);

		const health = responses.find((resp) => resp.status);
		expect((health?.status?.queue as Record<string, unknown>)?.mode).toBe("in-process");
		const { items } = readProject(project);
		expect(items.length).toBeGreaterThanOrEqual(1);
	});

	test("worker falls back to in-process mode when daemon pid is stale", async () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		const pidPath = getPidPath(dbPath);
		const db = createDatabase(dbPath);
		initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
		db.close();
		writeFileSync(pidPath, "999999", "utf-8");

		const responses = await runWorker(
			"cursor",
			project,
			[
				JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
				JSON.stringify({
					eventName: "toolExecute",
					session: "sess-1",
					invocationId: "call-1",
					tool: "Read",
					output:
						"Read src/index.ts and found daemon fallback path for queue runtime mode switching during worker initialization.",
				}),
				JSON.stringify({ command: "flush" }),
				JSON.stringify({ command: "health" }),
			],
			{ OPEN_MEM_DAEMON: "true" },
		);

		const health = responses.find((resp) => resp.status);
		expect((health?.status?.queue as Record<string, unknown>)?.mode).toBe("in-process");
		const { items } = readProject(project);
		expect(items.length).toBeGreaterThanOrEqual(1);
	});

	test("claude worker creates and removes role-specific PID file", async () => {
		await assertWorkerPidLifecycle("claude-code");
	});

	test("cursor worker creates and removes role-specific PID file", async () => {
		await assertWorkerPidLifecycle("cursor");
	});

	test("worker shutdown preserves pid file ownership when pid changes", async () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		const pidPath = getPlatformWorkerPidPath(dbPath, "claude");

		const proc = Bun.spawn([process.execPath, "run", "src/claude-code.ts", "--project", project], {
			cwd: join(import.meta.dir, "../.."),
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				OPEN_MEM_COMPRESSION: "false",
				OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
				OPEN_MEM_PLATFORM_CURSOR: "true",
			},
		});
		tempPids.push(proc.pid);

		await waitForFile(pidPath, 2000);
		const foreign = await createSignalTrapProcess(project);
		writeFileSync(pidPath, String(foreign.pid), "utf-8");

		proc.stdin.write(`${JSON.stringify({ command: "shutdown" })}\n`);
		proc.stdin.end();

		const code = await proc.exited;
		if (code !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`worker failed (claude-code): ${stderr}`);
		}

		expect(existsSync(pidPath)).toBe(true);
		expect(readFileSync(pidPath, "utf-8").trim()).toBe(String(foreign.pid));
	});

	test("maintenance preflight reports stale worker pid without mutating pid files", () => {
		const project = createTempProject();
		const dbPath = join(project, ".open-mem", "memory.db");
		mkdirSync(join(project, ".open-mem"), { recursive: true });
		const stalePidPath = getPlatformWorkerPidPath(dbPath, "claude");
		writeFileSync(stalePidPath, "999999", "utf-8");

		const preflight = getMaintenancePreflightStatus(dbPath);
		const workerCheck = preflight.checks.find(
			(check) => check.processType === "platform-worker-claude",
		);

		expect(workerCheck).toBeDefined();
		expect(workerCheck?.state).toBe("dead");
		expect(workerCheck?.stalePid).toBe(999999);
		expect(workerCheck?.stalePidRemoved).toBe(false);
		expect(existsSync(stalePidPath)).toBe(true);
	});

	test("plugin enqueue-only path falls back to in-process when daemon signal fails", async () => {
		const project = createTempProject();
		const previousDaemon = process.env.OPEN_MEM_DAEMON;
		const originalStart = DaemonManager.prototype.start;
		const originalStop = DaemonManager.prototype.stop;
		const originalIsRunning = DaemonManager.prototype.isRunning;
		const originalGetStatus = DaemonManager.prototype.getStatus;
		const originalSignal = DaemonManager.prototype.signal;
		const originalSetMode = QueueProcessor.prototype.setMode;
		const seenModes: string[] = [];

		DaemonManager.prototype.start = () => true;
		DaemonManager.prototype.stop = () => {};
		DaemonManager.prototype.isRunning = () => true;
		DaemonManager.prototype.getStatus = () => ({
			state: "running",
			running: true,
			pid: process.pid,
			stalePid: null,
			stalePidRemoved: false,
		});
		DaemonManager.prototype.signal = (message: string) => ({
			ok: false,
			state: "delivery-failed",
			via: "none",
			pid: process.pid,
			message,
			error: "forced signal failure for integration parity test",
		});
		QueueProcessor.prototype.setMode = function setModeWithTrace(mode) {
			seenModes.push(mode);
			return originalSetMode.call(this, mode);
		};

		try {
			process.env.OPEN_MEM_DAEMON = "true";
			const hooks = await plugin({
				client: {},
				project: "test",
				directory: project,
				worktree: project,
				serverUrl: "http://localhost:3000",
				$: {},
			});

			await hooks["tool.execute.after"]!(
				{ tool: "Read", sessionID: "sess-1", callID: "call-1" },
				{
					title: "Read output",
					output:
						"Read src/index.ts and confirmed daemon enqueue callback should degrade to in-process when PROCESS_NOW delivery fails.",
					metadata: {},
				},
			);

			expect(seenModes).toContain("enqueue-only");
			expect(seenModes).toContain("in-process");
			expect(seenModes.at(-1)).toBe("in-process");
		} finally {
			if (previousDaemon === undefined) {
				delete process.env.OPEN_MEM_DAEMON;
			} else {
				process.env.OPEN_MEM_DAEMON = previousDaemon;
			}
			DaemonManager.prototype.start = originalStart;
			DaemonManager.prototype.stop = originalStop;
			DaemonManager.prototype.isRunning = originalIsRunning;
			DaemonManager.prototype.getStatus = originalGetStatus;
			DaemonManager.prototype.signal = originalSignal;
			QueueProcessor.prototype.setMode = originalSetMode;
		}
	});
});
