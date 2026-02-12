// =============================================================================
// open-mem — Plugin Integration Tests (Task 18)
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import plugin from "../../src/index";

let cleanupDirs: string[] = [];

afterEach(() => {
	for (const dir of cleanupDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
	cleanupDirs = [];
});

function makeInput(dir: string) {
	return {
		client: {},
		project: "test",
		directory: dir,
		worktree: dir,
		serverUrl: "http://localhost:3000",
		$: {},
	};
}

describe("Plugin entry point", () => {
	test("initializes successfully", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		const hooks = await plugin(makeInput(dir));
		expect(hooks).toBeDefined();
	});

	test("returns all expected hooks", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		const hooks = await plugin(makeInput(dir));
		expect(hooks["tool.execute.after"]).toBeDefined();
		expect(hooks.event).toBeDefined();
		expect(hooks["experimental.chat.system.transform"]).toBeDefined();
		expect(hooks["experimental.session.compacting"]).toBeDefined();
	});

	test("returns 10 tools", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		const hooks = await plugin(makeInput(dir));
		expect(Object.keys(hooks.tool!)).toHaveLength(10);
		const names = Object.keys(hooks.tool ?? {});
		expect(names).toContain("mem-find");
		expect(names).toContain("mem-create");
		expect(names).toContain("mem-history");
		expect(names).toContain("mem-get");
		expect(names).toContain("mem-export");
		expect(names).toContain("mem-import");
		expect(names).toContain("mem-revise");
		expect(names).toContain("mem-remove");
		expect(names).toContain("mem-maintenance");
		expect(names).toContain("mem-help");
	});

	test("creates database file", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		await plugin(makeInput(dir));
		expect(existsSync(`${dir}/.open-mem/memory.db`)).toBe(true);
	});

	test("works without API key", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		// Should not throw even without ANTHROPIC_API_KEY
		const hooks = await plugin(makeInput(dir));
		expect(hooks).toBeDefined();
	});

	test("does not re-export runtime values (only default + types)", async () => {
		const mod = await import("../../src/index");
		// Named runtime exports were removed to prevent opencode plugin loader crashes
		expect((mod as Record<string, unknown>).resolveConfig).toBeUndefined();
		expect((mod as Record<string, unknown>).getDefaultConfig).toBeUndefined();
		expect((mod as Record<string, unknown>).PlatformIngestionRuntime).toBeUndefined();
		// Default export must still exist
		expect(typeof mod.default).toBe("function");
	});
});
