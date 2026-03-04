// =============================================================================
// open-mem — DaemonManager Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DaemonManager, getMaintenancePreflightStatus } from "../../src/daemon/manager";
import { getKnownProcessPidFiles, isProcessAlive, readPid } from "../../src/daemon/pid";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function tmpDir(): string {
	const dir = `/tmp/open-mem-manager-test-${randomUUID()}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

let cleanupPaths: string[] = [];
let cleanupPids: number[] = [];

afterEach(() => {
	for (const pid of cleanupPids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// process may already be dead
		}
	}
	cleanupPids = [];
	for (const p of cleanupPaths) {
		try {
			const { unlinkSync } = require("node:fs");
			unlinkSync(p);
		} catch {
			// file may not exist
		}
	}
	cleanupPaths = [];
});

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("DaemonManager", () => {
	// -------------------------------------------------------------------------
	// isRunning
	// -------------------------------------------------------------------------

	test("isRunning returns false when no PID file exists", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(manager.isRunning()).toBe(false);
	});

	test("isRunning returns false when PID file exists but process is dead", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, "99999999", "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(manager.isRunning()).toBe(false);
	});

	test("isRunning returns true when PID file exists and process is alive", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		// Use current process PID — guaranteed alive
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(manager.isRunning()).toBe(true);
	});

	// -------------------------------------------------------------------------
	// getStatus
	// -------------------------------------------------------------------------

	test("getStatus returns running=false, pid=null when no daemon", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const status = manager.getStatus();
		expect(status.state).toBe("missing");
		expect(status.running).toBe(false);
		expect(status.pid).toBeNull();
		expect(status.stalePid).toBeNull();
	});

	test("getStatus returns running=true with PID when daemon is alive", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const status = manager.getStatus();
		expect(status.state).toBe("running");
		expect(status.running).toBe(true);
		expect(status.pid).toBe(process.pid);
		expect(status.stalePid).toBeNull();
	});

	test("getStatus returns state=dead with stale PID when process is dead", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, "99999999", "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const status = manager.getStatus();
		expect(status.state).toBe("dead");
		expect(status.running).toBe(false);
		expect(status.pid).toBeNull();
		expect(status.stalePid).toBe(99999999);
		expect(status.stalePidRemoved).toBe(true);
		expect(existsSync(pidPath)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// signal
	// -------------------------------------------------------------------------

	test("getMaintenancePreflightStatus is not blocked when no processes are active", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const status = getMaintenancePreflightStatus(dbPath);
		const knownProcessPidFiles = getKnownProcessPidFiles(dbPath);

		expect(status.blocked).toBe(false);
		expect(status.activeProcesses.length).toBe(0);
		expect(status.checks.map((check) => check.processType)).toEqual([
			"daemon",
			"platform-worker-claude",
			"platform-worker-cursor",
		]);
		expect(status.checks.map((check) => check.pidPath)).toEqual(
			knownProcessPidFiles.map((pidFile) => pidFile.pidPath),
		);
	});

	test("getMaintenancePreflightStatus is blocked when daemon pid is alive", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const status = getMaintenancePreflightStatus(`${dir}/memory.db`);

		expect(status.blocked).toBe(true);
		expect(status.activeProcesses.length).toBe(1);
		expect(status.activeProcesses[0]?.processType).toBe("daemon");
		expect(status.activeProcesses[0]?.pid).toBe(process.pid);
	});

	test("getMaintenancePreflightStatus is blocked when worker pid is alive", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/platform-worker-claude.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const status = getMaintenancePreflightStatus(`${dir}/memory.db`);

		expect(status.blocked).toBe(true);
		expect(status.activeProcesses.length).toBe(1);
		expect(status.activeProcesses[0]?.processType).toBe("platform-worker-claude");
		expect(status.activeProcesses[0]?.pid).toBe(process.pid);
	});

	test("getMaintenancePreflightStatus does not delete stale pid files", () => {
		const dir = tmpDir();
		const daemonPidPath = `${dir}/worker.pid`;
		const workerPidPath = `${dir}/platform-worker-claude.pid`;
		writeFileSync(daemonPidPath, "99999999", "utf-8");
		writeFileSync(workerPidPath, "99999998", "utf-8");
		cleanupPaths.push(daemonPidPath, workerPidPath);

		const status = getMaintenancePreflightStatus(`${dir}/memory.db`);
		const daemon = status.checks.find((check) => check.processType === "daemon");
		const worker = status.checks.find((check) => check.processType === "platform-worker-claude");

		expect(daemon?.state).toBe("dead");
		expect(daemon?.stalePid).toBe(99999999);
		expect(daemon?.stalePidRemoved).toBe(false);
		expect(existsSync(daemonPidPath)).toBe(true);

		expect(worker?.state).toBe("dead");
		expect(worker?.stalePid).toBe(99999998);
		expect(worker?.stalePidRemoved).toBe(false);
		expect(existsSync(workerPidPath)).toBe(true);
	});

	test("signal returns no-daemon when no PID file exists", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const result = manager.signal("PROCESS_NOW");
		expect(result.ok).toBe(false);
		expect(result.state).toBe("no-daemon");
		expect(result.via).toBe("none");
	});

	test("daemon signal failure states are explicit and stable", () => {
		const noDaemonDir = tmpDir();
		const noDaemonManager = new DaemonManager({
			dbPath: `${noDaemonDir}/memory.db`,
			projectPath: noDaemonDir,
			daemonScript: "nonexistent.ts",
		});
		const noDaemon = noDaemonManager.signal("PROCESS_NOW");
		expect(noDaemon).toMatchObject({ ok: false, state: "no-daemon", via: "none", pid: null });

		const deadDaemonDir = tmpDir();
		const deadDaemonPidPath = `${deadDaemonDir}/worker.pid`;
		writeFileSync(deadDaemonPidPath, "99999999", "utf-8");
		cleanupPaths.push(deadDaemonPidPath);
		const deadDaemonManager = new DaemonManager({
			dbPath: `${deadDaemonDir}/memory.db`,
			projectPath: deadDaemonDir,
			daemonScript: "nonexistent.ts",
		});
		const deadDaemon = deadDaemonManager.signal("PROCESS_NOW");
		expect(deadDaemon).toMatchObject({
			ok: false,
			state: "daemon-dead",
			via: "none",
			pid: 99999999,
		});

		const deliveryFailedDir = tmpDir();
		const deliveryFailedManager = new DaemonManager({
			dbPath: `${deliveryFailedDir}/memory.db`,
			projectPath: deliveryFailedDir,
			daemonScript: "nonexistent.ts",
		});
		(
			deliveryFailedManager as unknown as {
				getStatus: () => ReturnType<DaemonManager["getStatus"]>;
			}
		).getStatus = () => ({
			state: "running",
			running: true,
			pid: null,
			stalePid: null,
			stalePidRemoved: false,
		});
		const deliveryFailed = deliveryFailedManager.signal("PROCESS_NOW");
		expect(deliveryFailed).toMatchObject({
			ok: false,
			state: "delivery-failed",
			via: "none",
			pid: null,
			message: "PROCESS_NOW",
		});
		expect(deliveryFailed.error).toContain("did not expose a PID");
	});

	test("signal returns daemon-dead when PID file points to dead process", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, "99999999", "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const result = manager.signal("PROCESS_NOW");
		expect(result.ok).toBe(false);
		expect(result.state).toBe("daemon-dead");
		expect(result.pid).toBe(99999999);
	});

	test("signal returns delivery-failed when daemon is running without pid", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		(manager as unknown as { getStatus: () => ReturnType<DaemonManager["getStatus"]> }).getStatus =
			() => ({
				state: "running",
				running: true,
				pid: null,
				stalePid: null,
				stalePidRemoved: false,
			});

		const result = manager.signal("PROCESS_NOW");
		expect(result.ok).toBe(false);
		expect(result.state).toBe("delivery-failed");
		expect(result.via).toBe("none");
		expect(result.message).toBe("PROCESS_NOW");
		expect(result.error).toContain("did not expose a PID");
	});

	test("signal returns delivered when daemon subprocess IPC is available", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		let calledWith: string | null = null;
		(manager as unknown as Record<string, unknown>).subprocess = {
			send(message: string) {
				calledWith = message;
			},
		};

		const result = manager.signal("PROCESS_NOW");
		expect(calledWith === "PROCESS_NOW").toBe(true);
		expect(result.ok).toBe(true);
		expect(result.state).toBe("delivered");
		expect(result.via).toBe("ipc");
	});

	test("signal catch path preserves structured result when status lookup throws", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		(manager as unknown as Record<string, unknown>).subprocess = {
			send() {
				throw new Error("ipc send failed");
			},
		};

		(manager as unknown as { getStatus: () => ReturnType<DaemonManager["getStatus"]> }).getStatus =
			() => {
				throw new Error("status unavailable");
			};

		const result = manager.signal("PROCESS_NOW");
		expect(result).toEqual({
			ok: false,
			state: "delivery-failed",
			via: "none",
			pid: null,
			message: "PROCESS_NOW",
			error: "Error: ipc send failed",
		});
	});

	test("signal returns delivered via os-signal when daemon is running", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const originalKill = process.kill.bind(process);
		const killCalls: Array<{ pid: number; signal: NodeJS.Signals | number | undefined }> = [];
		(
			process as unknown as {
				kill: (pid: number, signal?: NodeJS.Signals | number) => boolean;
			}
		).kill = (pid, signal) => {
			killCalls.push({ pid, signal });
			return true;
		};

		try {
			const result = manager.signal("PROCESS_NOW");
			expect(result.ok).toBe(true);
			expect(result.state).toBe("delivered");
			expect(result.via).toBe("os-signal");
			expect(result.pid).toBe(process.pid);
			expect(killCalls.some((call) => call.pid === process.pid && call.signal === "SIGUSR1")).toBe(
				true,
			);
		} finally {
			(
				process as unknown as {
					kill: (pid: number, signal?: NodeJS.Signals | number) => boolean;
				}
			).kill = originalKill;
		}
	});

	// -------------------------------------------------------------------------
	// stop
	// -------------------------------------------------------------------------

	test("stop removes PID file and does not throw if process is dead", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, "99999999", "utf-8");

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(() => manager.stop()).not.toThrow();
		expect(existsSync(pidPath)).toBe(false);
	});

	test("stop is safe to call when no PID file exists", () => {
		const dir = tmpDir();
		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(() => manager.stop()).not.toThrow();
	});

	test("stop sends SIGTERM to alive process and removes PID file", async () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;

		// Spawn a real process we can kill
		const proc = Bun.spawn(["bun", "-e", "await Bun.sleep(60000)"], {
			stdio: ["ignore", "ignore", "ignore"],
		});
		const pid = proc.pid;
		cleanupPids.push(pid);
		writeFileSync(pidPath, String(pid), "utf-8");

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		expect(isProcessAlive(pid)).toBe(true);
		manager.stop();

		// Give OS a moment to deliver signal
		await sleep(200);

		expect(existsSync(pidPath)).toBe(false);
		expect(isProcessAlive(pid)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// start
	// -------------------------------------------------------------------------

	test("start returns false if daemon is already running", () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: "nonexistent.ts",
		});

		const result = manager.start();
		expect(result).toBe(false);
	});

	test("start spawns daemon and returns true when PID file appears", async () => {
		const dir = tmpDir();
		const pidPath = `${dir}/worker.pid`;

		// Create a tiny mock daemon script that writes a PID file and sleeps
		const mockScript = `${dir}/mock-daemon.ts`;
		const scriptContent = [
			'import { writeFileSync, mkdirSync } from "node:fs";',
			'import { parseArgs } from "node:util";',
			"const { values } = parseArgs({ options: { project: { type: 'string' } }, strict: false });",
			`const pidPath = "${pidPath}";`,
			"writeFileSync(pidPath, String(process.pid), 'utf-8');",
			"await Bun.sleep(60000);",
		].join("\n");
		writeFileSync(mockScript, scriptContent, "utf-8");
		cleanupPaths.push(mockScript);
		cleanupPaths.push(pidPath);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: mockScript,
		});

		const result = manager.start();
		expect(result).toBe(true);

		expect(existsSync(pidPath)).toBe(true);
		const pid = readPid(pidPath);
		expect(pid).not.toBeNull();
		if (pid !== null) {
			expect(isProcessAlive(pid)).toBe(true);
			cleanupPids.push(pid);
		}
	});

	test("start returns false when daemon fails to write PID file within timeout", () => {
		const dir = tmpDir();

		// Script that does NOT write a PID file — just exits immediately
		const mockScript = `${dir}/bad-daemon.ts`;
		writeFileSync(mockScript, "process.exit(1);", "utf-8");
		cleanupPaths.push(mockScript);

		const manager = new DaemonManager({
			dbPath: `${dir}/memory.db`,
			projectPath: dir,
			daemonScript: mockScript,
		});

		// This will poll for PID file and eventually time out returning false
		const result = manager.start();
		expect(result).toBe(false);
	});
});
