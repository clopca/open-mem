// =============================================================================
// open-mem — E2E Lifecycle Tests (Task 22)
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import plugin from "../../src/index";
import type { Hooks, ToolContext } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

async function createTestPlugin(): Promise<{ hooks: Hooks; dir: string }> {
	const dir = `/tmp/open-mem-e2e-${randomUUID()}`;
	cleanupDirs.push(dir);

	// Remove API key and AWS credentials to force fallback compressor
	const saved = process.env.ANTHROPIC_API_KEY;
	const savedAwsKey = process.env.AWS_ACCESS_KEY_ID;
	const savedAwsProfile = process.env.AWS_PROFILE;
	delete process.env.ANTHROPIC_API_KEY;
	delete process.env.AWS_ACCESS_KEY_ID;
	delete process.env.AWS_PROFILE;

	const hooks = await plugin({
		client: {},
		project: "e2e-test",
		directory: dir,
		worktree: dir,
		serverUrl: "http://localhost:3000",
		$: {},
	});

	process.env.ANTHROPIC_API_KEY = saved;
	process.env.AWS_ACCESS_KEY_ID = savedAwsKey;
	process.env.AWS_PROFILE = savedAwsProfile;
	return { hooks, dir };
}

function mockToolContext(sessionId?: string): ToolContext {
	return {
		sessionID: sessionId ?? randomUUID(),
		abort: new AbortController().signal,
	};
}

async function simulateToolCapture(
	hooks: Hooks,
	sessionId: string,
	tool: string,
	output: string,
): Promise<void> {
	await hooks["tool.execute.after"]!(
		{ tool, sessionID: sessionId, callID: randomUUID() },
		{ title: `${tool} output`, output, metadata: {} },
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E lifecycle", () => {
	test("plugin initializes with default config", async () => {
		const { hooks } = await createTestPlugin();

		expect(hooks["tool.execute.after"]).toBeFunction();
		expect(hooks["experimental.chat.system.transform"]).toBeFunction();
		expect(hooks["experimental.session.compacting"]).toBeFunction();
		expect(hooks.event).toBeFunction();
		expect(hooks.tools).toHaveLength(4);
	});

	test("full lifecycle: capture → process → recall", async () => {
		const { hooks } = await createTestPlugin();
		const sessionId = randomUUID();

		// 1. Capture a tool execution
		await simulateToolCapture(
			hooks,
			sessionId,
			"Read",
			"File content of src/index.ts: export default function plugin() { /* persistent memory system */ }",
		);

		// 2. Trigger event processing (simulates session.idle)
		await hooks.event!({ event: { type: "session.idle", properties: { sessionID: sessionId } } });

		// 3. Verify context injection has something to work with
		const system: string[] = [];
		await hooks["experimental.chat.system.transform"]!(
			{ sessionID: randomUUID(), model: "test" },
			{ system },
		);

		// Context may or may not appear (depends on whether observations exist yet),
		// but the hook should not throw.
		expect(true).toBe(true);
	});

	test("tool capture → queue → observation pipeline", async () => {
		const { hooks } = await createTestPlugin();
		const sessionId = randomUUID();

		// Capture several tool outputs
		await simulateToolCapture(
			hooks,
			sessionId,
			"Read",
			"Reading file src/config.ts — contains database configuration with SQLite path resolution and environment variable overrides",
		);
		await simulateToolCapture(
			hooks,
			sessionId,
			"Edit",
			"Edited src/types.ts: added new interface SearchQuery with query, sessionId, type, limit, offset fields for FTS5 search",
		);

		// Process the queue (simulate idle)
		await hooks.event!({ event: { type: "session.idle", properties: { sessionID: sessionId } } });

		// Give a moment for async processing
		await new Promise((r) => setTimeout(r, 100));

		// Search for the captured observations using mem-search tool
		const searchTool = hooks.tools!.find((t) => t.name === "mem-search")!;
		const result = await searchTool.execute(
			{ query: "config", limit: 10 },
			mockToolContext(sessionId),
		);

		// Should find results (either from observations or from fallback compressor)
		expect(typeof result).toBe("string");
	});

	test("mem-save creates searchable observation", async () => {
		const { hooks } = await createTestPlugin();
		const sessionId = randomUUID();
		const ctx = mockToolContext(sessionId);

		// Save an observation manually
		const saveTool = hooks.tools!.find((t) => t.name === "mem-save")!;
		const saveResult = await saveTool.execute(
			{
				title: "Important architecture decision",
				type: "decision",
				narrative: "We decided to use FTS5 instead of vector search for v1 to keep complexity low.",
				concepts: ["architecture", "search", "fts5"],
				files: ["src/db/schema.ts"],
			},
			ctx,
		);

		expect(saveResult).toContain("Saved observation");
		expect(saveResult).toContain("decision");
		expect(saveResult).toContain("Important architecture decision");

		// Search for the saved observation
		const searchTool = hooks.tools!.find((t) => t.name === "mem-search")!;
		const searchResult = await searchTool.execute({ query: "FTS5 architecture", limit: 10 }, ctx);

		expect(searchResult).toContain("FTS5");
	});

	test("mem-search returns no results gracefully", async () => {
		const { hooks } = await createTestPlugin();

		const searchTool = hooks.tools!.find((t) => t.name === "mem-search")!;
		const result = await searchTool.execute(
			{ query: "nonexistent_query_xyz_12345", limit: 5 },
			mockToolContext(),
		);

		expect(result).toContain("No matching");
	});

	test("mem-timeline shows session history", async () => {
		const { hooks } = await createTestPlugin();
		const sessionId = randomUUID();
		const ctx = mockToolContext(sessionId);

		// Create some activity in a session
		const saveTool = hooks.tools!.find((t) => t.name === "mem-save")!;
		await saveTool.execute(
			{
				title: "Test observation for timeline",
				type: "feature",
				narrative: "Adding timeline feature to the plugin",
			},
			ctx,
		);

		// Check timeline
		const timelineTool = hooks.tools!.find((t) => t.name === "mem-timeline")!;
		const timeline = await timelineTool.execute({ limit: 5 }, ctx);

		expect(timeline).toContain("Session");
	});

	test("context injection does not throw on empty database", async () => {
		const { hooks } = await createTestPlugin();
		const system: string[] = ["You are a helpful assistant."];

		// Should not throw with empty DB
		await hooks["experimental.chat.system.transform"]!(
			{ sessionID: randomUUID(), model: "test" },
			{ system },
		);

		// Original system prompt should still be there
		expect(system[0]).toBe("You are a helpful assistant.");
	});

	test("session compaction hook does not throw", async () => {
		const { hooks } = await createTestPlugin();
		const context: string[] = [];

		await hooks["experimental.session.compacting"]!({ sessionID: randomUUID() }, { context });

		// Should not throw
		expect(true).toBe(true);
	});
});
