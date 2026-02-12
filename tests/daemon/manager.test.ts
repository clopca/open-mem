// =============================================================================
// open-mem — DaemonManager Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { DaemonManager } from "../../src/daemon/manager";
import { isProcessAlive, readPid, removePid } from "../../src/daemon/pid";

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
		expect(status.running).toBe(false);
		expect(status.pid).toBeNull();
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
		expect(status.running).toBe(true);
		expect(status.pid).toBe(process.pid);
	});

	test("getStatus returns running=false with stale PID when process is dead", () => {
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
		expect(status.running).toBe(false);
		expect(status.pid).toBeNull();
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
