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
		expect(names).toContain("memory.find");
		expect(names).toContain("memory.create");
		expect(names).toContain("memory.history");
		expect(names).toContain("memory.get");
		expect(names).toContain("memory.transfer.export");
		expect(names).toContain("memory.transfer.import");
		expect(names).toContain("memory.revise");
		expect(names).toContain("memory.remove");
		expect(names).toContain("memory.maintenance");
		expect(names).toContain("memory.help");
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
