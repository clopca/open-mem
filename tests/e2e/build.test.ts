// =============================================================================
// open-mem — Build Verification Tests (Task 22)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const DIST = resolve(import.meta.dir, "../../dist");

describe("Build verification", () => {
	test("build produces dist/index.js", () => {
		const path = `${DIST}/index.js`;
		expect(existsSync(path)).toBe(true);
		const stat = statSync(path);
		expect(stat.size).toBeGreaterThan(0);
	});

	test("build produces dist/index.d.ts", () => {
		const path = `${DIST}/index.d.ts`;
		expect(existsSync(path)).toBe(true);
		const stat = statSync(path);
		expect(stat.size).toBeGreaterThan(0);
	});

	test("build produces dist/types.d.ts", () => {
		const path = `${DIST}/types.d.ts`;
		expect(existsSync(path)).toBe(true);
	});

	test("dist/index.js is importable and has default export", async () => {
		const mod = await import(`${DIST}/index.js`);
		expect(mod.default).toBeDefined();
		expect(typeof mod.default).toBe("function");
	});

	test("dist/index.js does not expose runtime helper exports", async () => {
		const mod = await import(`${DIST}/index.js`);
		expect((mod as Record<string, unknown>).PlatformIngestionRuntime).toBeUndefined();
		expect((mod as Record<string, unknown>).createOpenCodePlatformAdapter).toBeUndefined();
		expect((mod as Record<string, unknown>).createCursorAdapter).toBeUndefined();
		expect((mod as Record<string, unknown>).createClaudeCodeAdapter).toBeUndefined();
		expect((mod as Record<string, unknown>).resolveConfig).toBeUndefined();
		expect((mod as Record<string, unknown>).getDefaultConfig).toBeUndefined();
		expect((mod as Record<string, unknown>).sendBridgeHttpEvent).toBeUndefined();
		expect((mod as Record<string, unknown>).getBridgeHealth).toBeUndefined();
		expect((mod as Record<string, unknown>).isBridgeSuccess).toBeUndefined();
	});

	test("dist/index.js bundle is under 250KB", () => {
		const stat = statSync(`${DIST}/index.js`);
		// Minified bundle should be well under 250KB
		expect(stat.size).toBeLessThan(250 * 1024);
	});

	test("dist/config.d.ts exports resolveConfig", async () => {
		const path = `${DIST}/config.d.ts`;
		expect(existsSync(path)).toBe(true);
		const content = await Bun.file(path).text();
		expect(content).toContain("resolveConfig");
	});
});
