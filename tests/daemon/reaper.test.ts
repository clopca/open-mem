// =============================================================================
// open-mem — Orphan Daemon Reaper Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { getPidPath, readPid } from "../../src/daemon/pid";
import { reapOrphanDaemons } from "../../src/daemon/reaper";

function tmpDir(): string {
	const dir = `/tmp/open-mem-reaper-test-${randomUUID()}`;
	mkdirSync(dir, { recursive: true });
	return dir;
}

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

describe("reapOrphanDaemons", () => {
	test("returns reaped=0 when no PID file exists", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	test("removes stale PID file when process is dead", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const pidPath = getPidPath(dbPath);
		writeFileSync(pidPath, "99999999", "utf-8");
		cleanupPaths.push(pidPath);

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(1);
		expect(result.errors).toHaveLength(0);
		expect(existsSync(pidPath)).toBe(false);
	});

	test("skips alive process without killing it", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const pidPath = getPidPath(dbPath);
		writeFileSync(pidPath, String(process.pid), "utf-8");
		cleanupPaths.push(pidPath);

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(0);
		expect(result.errors).toHaveLength(0);
		expect(existsSync(pidPath)).toBe(true);
	});

	test("removes corrupt PID file with invalid content", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const pidPath = getPidPath(dbPath);
		writeFileSync(pidPath, "not-a-number", "utf-8");
		cleanupPaths.push(pidPath);

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(1);
		expect(result.errors).toHaveLength(0);
		expect(existsSync(pidPath)).toBe(false);
	});

	test("removes empty PID file", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const pidPath = getPidPath(dbPath);
		writeFileSync(pidPath, "", "utf-8");
		cleanupPaths.push(pidPath);

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(1);
		expect(result.errors).toHaveLength(0);
		expect(existsSync(pidPath)).toBe(false);
	});

	test("handles non-existent parent directory gracefully", () => {
		const dbPath = `/tmp/open-mem-reaper-nonexistent-${randomUUID()}/memory.db`;

		const result = reapOrphanDaemons(dbPath);

		expect(result.reaped).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	test("is idempotent — second call is a no-op after reaping", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;
		const pidPath = getPidPath(dbPath);
		writeFileSync(pidPath, "99999999", "utf-8");
		cleanupPaths.push(pidPath);

		const first = reapOrphanDaemons(dbPath);
		expect(first.reaped).toBe(1);

		const second = reapOrphanDaemons(dbPath);
		expect(second.reaped).toBe(0);
		expect(second.errors).toHaveLength(0);
	});

	test("returns correct ReapResult shape", () => {
		const dir = tmpDir();
		const dbPath = `${dir}/memory.db`;

		const result = reapOrphanDaemons(dbPath);

		expect(result).toHaveProperty("reaped");
		expect(result).toHaveProperty("errors");
		expect(typeof result.reaped).toBe("number");
		expect(Array.isArray(result.errors)).toBe(true);
	});
});
