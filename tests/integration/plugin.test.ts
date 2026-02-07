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

	test("returns 6 tools", async () => {
		const dir = `/tmp/open-mem-plugin-test-${randomUUID()}`;
		cleanupDirs.push(dir);
		const hooks = await plugin(makeInput(dir));
		expect(hooks.tools).toHaveLength(6);
		const names = hooks.tools?.map((t) => t.name) ?? [];
		expect(names).toContain("mem-search");
		expect(names).toContain("mem-save");
		expect(names).toContain("mem-timeline");
		expect(names).toContain("mem-recall");
		expect(names).toContain("mem-export");
		expect(names).toContain("mem-import");
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

	test("re-exports types and config functions", async () => {
		const mod = await import("../../src/index");
		expect(typeof mod.resolveConfig).toBe("function");
		expect(typeof mod.getDefaultConfig).toBe("function");
	});
});
