import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostname } from "node:os";
import {
	AdvisoryLockTimeoutError,
	acquireWriteLock,
	type ProcessRole,
} from "../../src/db/advisory-lock";

let cleanupPaths: string[] = [];

afterEach(() => {
	for (const path of cleanupPaths) {
		try {
			unlinkSync(path);
		} catch {
			// ignore missing paths
		}
	}
	cleanupPaths = [];
});

describe("Advisory lock", () => {
	test("test_lock_single_holder", async () => {
		const lockPath = `/tmp/open-mem-test-${randomUUID()}.write.lock`;
		const markerPath = `/tmp/open-mem-test-${randomUUID()}.marker`;
		cleanupPaths.push(lockPath, markerPath);

		const parentLock = acquireWriteLock(lockPath, {
			role: "plugin",
			timeoutMs: 2_000,
			retryIntervalMs: 10,
		});

		const advisoryLockModulePath = resolve(import.meta.dir, "../../src/db/advisory-lock.ts");
		const script = `
import { acquireWriteLock } from ${JSON.stringify(advisoryLockModulePath)};
import { writeFileSync } from "node:fs";

const lock = acquireWriteLock(${JSON.stringify(lockPath)}, {
  role: "daemon",
  timeoutMs: 2000,
  retryIntervalMs: 10,
});
writeFileSync(${JSON.stringify(markerPath)}, "acquired", "utf8");
lock.release();
`;

		const child = Bun.spawn([process.execPath, "--eval", script], {
			stderr: "pipe",
			stdout: "pipe",
		});

		await Bun.sleep(100);
		expect(existsSync(markerPath)).toBe(false);

		parentLock.release();
		const exitCode = await child.exited;
		const stderrText = child.stderr ? await new Response(child.stderr).text() : "";

		expect(exitCode).toBe(0);
		expect(stderrText).toBe("");
		expect(readFileSync(markerPath, "utf8")).toBe("acquired");
	});

	test("test_lock_reentrant_nested", () => {
		const lockPath = `/tmp/open-mem-test-${randomUUID()}.write.lock`;
		cleanupPaths.push(lockPath);

		const outer = acquireWriteLock(lockPath, { role: "plugin" });
		const inner = acquireWriteLock(lockPath, { role: "maintenance" });

		expect(outer.reentrant).toBe(false);
		expect(inner.reentrant).toBe(true);
		expect(existsSync(lockPath)).toBe(true);

		inner.release();
		expect(existsSync(lockPath)).toBe(true);

		outer.release();
		expect(existsSync(lockPath)).toBe(false);

		const reacquired = acquireWriteLock(lockPath, { role: "plugin" });
		expect(reacquired.reentrant).toBe(false);
		reacquired.release();
		expect(existsSync(lockPath)).toBe(false);
	});



	test("test_lock_reaps_stale_owner", () => {
		const lockPath = `/tmp/open-mem-test-${randomUUID()}.write.lock`;
		cleanupPaths.push(lockPath);

		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: 999_999,
				role: "daemon" as ProcessRole,
				hostname: hostname(),
				acquiredAt: "2026-01-01T00:00:00.000Z",
			}),
			"utf8",
		);

		const lock = acquireWriteLock(lockPath, {
			role: "plugin",
			timeoutMs: 250,
			retryIntervalMs: 5,
		});

		expect(lock.reentrant).toBe(false);
		lock.release();
		expect(existsSync(lockPath)).toBe(false);
	});

	test("test_lock_timeout_error_context", () => {
		const lockPath = `/tmp/open-mem-test-${randomUUID()}.write.lock`;
		cleanupPaths.push(lockPath);

		const owner = {
			pid: 4242,
			role: "daemon" as ProcessRole,
			hostname: "test-host",
			acquiredAt: "2026-01-01T00:00:00.000Z",
			ownerId: "owner-1",
		};
		writeFileSync(lockPath, JSON.stringify(owner), "utf8");

		let nowTick = 0;
		const now = () => {
			nowTick += 60;
			return nowTick;
		};

		try {
			acquireWriteLock(lockPath, {
				role: "plugin",
				timeoutMs: 100,
				retryIntervalMs: 1,
				now,
			});
			expect.unreachable("expected timeout error");
		} catch (error) {
			expect(error).toBeInstanceOf(AdvisoryLockTimeoutError);
			const timeoutError = error as AdvisoryLockTimeoutError;
			expect(timeoutError.lockPath).toBe(lockPath);
			expect(timeoutError.role).toBe("plugin");
			expect(timeoutError.waitDurationMs).toBeGreaterThanOrEqual(100);
			expect(timeoutError.owner).toEqual(owner);
			expect(timeoutError.message).toContain("Timed out acquiring advisory write lock");
		}
	});
});
