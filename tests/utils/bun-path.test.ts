// =============================================================================
// open-mem — Bun PATH Resolution Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { _resetBunPathCache, resolveBunPath, resolveBunPathCached } from "../../src/utils/bun-path";

describe("resolveBunPath", () => {
	test("returns a string path in the current environment", () => {
		const result = resolveBunPath();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("finds bun via Bun.which in normal environment", () => {
		const result = resolveBunPath();
		const whichResult = Bun.which("bun");
		expect(whichResult).not.toBeNull();
		expect(result).toBe(whichResult as string);
	});

	test("returns an absolute path when bun is found", () => {
		const result = resolveBunPath();
		if (result !== "bun") {
			expect(result.startsWith("/")).toBe(true);
		}
	});

	test("result path contains 'bun' in the filename", () => {
		const result = resolveBunPath();
		expect(result).toContain("bun");
	});

	test("falls back when Bun.which returns null", () => {
		const originalWhich = Bun.which;
		const originalEnv = process.env.BUN_INSTALL;
		const originalPath = process.env.PATH;

		try {
			(Bun as { which: typeof Bun.which }).which = (() => null) as typeof Bun.which;
			delete process.env.BUN_INSTALL;

			process.env.PATH = "";

			const result = resolveBunPath();
			expect(typeof result).toBe("string");
			expect(result.length).toBeGreaterThan(0);
		} finally {
			process.env.PATH = originalPath;
			(Bun as { which: typeof Bun.which }).which = originalWhich;
			if (originalEnv !== undefined) {
				process.env.BUN_INSTALL = originalEnv;
			} else {
				delete process.env.BUN_INSTALL;
			}
		}
	});

	test("respects BUN_INSTALL environment variable", () => {
		const originalWhich = Bun.which;
		const originalEnv = process.env.BUN_INSTALL;

		try {
			(Bun as { which: typeof Bun.which }).which = (() => null) as typeof Bun.which;

			const whichResult = originalWhich("bun");
			if (whichResult) {
				const bunDir = whichResult.replace(/\/bin\/bun$/, "");
				process.env.BUN_INSTALL = bunDir;

				const result = resolveBunPath();
				expect(result).toBe(whichResult);
			}
		} finally {
			(Bun as { which: typeof Bun.which }).which = originalWhich;
			if (originalEnv !== undefined) {
				process.env.BUN_INSTALL = originalEnv;
			} else {
				delete process.env.BUN_INSTALL;
			}
		}
	});
});

describe("resolveBunPathCached", () => {
	beforeEach(() => {
		_resetBunPathCache();
	});

	afterEach(() => {
		_resetBunPathCache();
	});

	test("returns the same result as resolveBunPath", () => {
		const direct = resolveBunPath();
		const cached = resolveBunPathCached();
		expect(cached).toBe(direct);
	});

	test("returns the same reference on subsequent calls", () => {
		const first = resolveBunPathCached();
		const second = resolveBunPathCached();
		expect(first).toBe(second);
	});

	test("cache is reset by _resetBunPathCache", () => {
		const first = resolveBunPathCached();
		_resetBunPathCache();
		const second = resolveBunPathCached();
		expect(second).toBe(first);
	});
});
