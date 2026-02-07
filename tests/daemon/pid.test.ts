// =============================================================================
// open-mem — PID File Manager Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getPidPath, isProcessAlive, readPid, removePid, writePid } from "../../src/daemon/pid";

let cleanupPaths: string[] = [];

afterEach(() => {
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

describe("PID File Manager", () => {
	// -------------------------------------------------------------------------
	// writePid
	// -------------------------------------------------------------------------

	test("writePid writes current process PID to file", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;
		cleanupPaths.push(pidPath);

		writePid(pidPath);

		expect(existsSync(pidPath)).toBe(true);
		const content = readFileSync(pidPath, "utf-8");
		expect(Number.parseInt(content, 10)).toBe(process.pid);
	});

	test("writePid creates parent directories if missing", () => {
		const dir = `/tmp/open-mem-test-${randomUUID()}`;
		const pidPath = `${dir}/nested/worker.pid`;
		cleanupPaths.push(pidPath);

		writePid(pidPath);

		expect(existsSync(pidPath)).toBe(true);
		const content = readFileSync(pidPath, "utf-8");
		expect(Number.parseInt(content, 10)).toBe(process.pid);
	});

	// -------------------------------------------------------------------------
	// readPid
	// -------------------------------------------------------------------------

	test("readPid returns PID number from existing file", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;
		cleanupPaths.push(pidPath);

		writeFileSync(pidPath, "12345", "utf-8");

		const pid = readPid(pidPath);
		expect(pid).toBe(12345);
	});

	test("readPid returns null when file does not exist", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;

		const pid = readPid(pidPath);
		expect(pid).toBeNull();
	});

	test("readPid returns null for invalid (non-numeric) content", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;
		cleanupPaths.push(pidPath);

		writeFileSync(pidPath, "not-a-number", "utf-8");

		const pid = readPid(pidPath);
		expect(pid).toBeNull();
	});

	// -------------------------------------------------------------------------
	// isProcessAlive
	// -------------------------------------------------------------------------

	test("isProcessAlive returns true for current process", () => {
		expect(isProcessAlive(process.pid)).toBe(true);
	});

	test("isProcessAlive returns false for non-existent PID", () => {
		// PID 99999999 is extremely unlikely to exist
		expect(isProcessAlive(99999999)).toBe(false);
	});

	// -------------------------------------------------------------------------
	// removePid
	// -------------------------------------------------------------------------

	test("removePid removes existing PID file", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;
		writeFileSync(pidPath, "12345", "utf-8");
		expect(existsSync(pidPath)).toBe(true);

		removePid(pidPath);

		expect(existsSync(pidPath)).toBe(false);
	});

	test("removePid does not throw when file does not exist", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;

		expect(() => removePid(pidPath)).not.toThrow();
	});

	// -------------------------------------------------------------------------
	// getPidPath
	// -------------------------------------------------------------------------

	test("getPidPath derives worker.pid from database path", () => {
		const dbPath = "/path/to/.open-mem/memory.db";
		expect(getPidPath(dbPath)).toBe("/path/to/.open-mem/worker.pid");
	});

	test("getPidPath handles various database filenames", () => {
		expect(getPidPath("/home/user/.open-mem/data.db")).toBe("/home/user/.open-mem/worker.pid");
		expect(getPidPath("/tmp/test.db")).toBe("/tmp/worker.pid");
	});
});
