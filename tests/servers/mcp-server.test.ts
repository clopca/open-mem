// =============================================================================
// open-mem — MCP Server Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

async function callServer(messages: Array<Record<string, unknown>>): Promise<string[]> {
	const input = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
	const helperPath = `${import.meta.dir}/mcp-server-helper.ts`;

	const proc = Bun.spawn(["bun", "run", helperPath, dbPath], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(input);
	proc.stdin.end();

	const output = await new Response(proc.stdout).text();
	proc.kill();

	return output
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => line.trim());
}

// =============================================================================
// MCP Server via subprocess
// =============================================================================

describe("McpServer", () => {
	test("handles initialize and returns capabilities", async () => {
		const lines = await callServer([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.jsonrpc).toBe("2.0");
		expect(response.id).toBe(1);
		expect(response.result.protocolVersion).toBe("2024-11-05");
		expect(response.result.capabilities.tools).toBeDefined();
		expect(response.result.serverInfo.name).toBe("open-mem");
	});

	test("handles tools/list and returns 8 tools", async () => {
		const lines = await callServer([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.result.tools).toHaveLength(8);
		const toolNames = response.result.tools.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("mem-search");
		expect(toolNames).toContain("mem-recall");
		expect(toolNames).toContain("mem-timeline");
		expect(toolNames).toContain("mem-save");
		expect(toolNames).toContain("mem-export");
		expect(toolNames).toContain("mem-import");
		expect(toolNames).toContain("mem-update");
		expect(toolNames).toContain("mem-delete");
	});

	test("handles tools/call with mem-search", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "mem-search", arguments: { query: "test" } },
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.id).toBe(1);
		expect(response.result.content).toBeDefined();
		expect(response.result.content[0].type).toBe("text");
	});

	test("returns error for unknown tool", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "nonexistent-tool", arguments: {} },
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.result.content[0].text).toContain("Unknown tool");
		expect(response.result.isError).toBe(true);
	});

	test("returns error for missing tool name", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { arguments: {} },
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.error).toBeDefined();
		expect(response.error.message).toContain("Missing tool name");
	});

	test("ignores notifications (no id in message)", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 1, method: "ping" },
		]);

		const responses = lines.map((l) => JSON.parse(l));
		expect(responses).toHaveLength(1);
		expect(responses[0].id).toBe(1);
	});

	test("returns error for unknown method", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "unknown/method", params: {} },
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.error).toBeDefined();
		expect(response.error.code).toBe(-32601);
		expect(response.error.message).toContain("Method not found");
	});

	test("handles ping", async () => {
		const lines = await callServer([{ jsonrpc: "2.0", id: 42, method: "ping" }]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.id).toBe(42);
		expect(response.result).toEqual({});
	});

	test("handles mem-save tool call", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "mem-save",
					arguments: {
						title: "Test observation",
						type: "discovery",
						narrative: "This is a test observation for MCP server.",
					},
				},
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.result.content[0].text).toContain("Saved observation");
		expect(response.result.content[0].text).toContain("Test observation");
	});

	test("handles mem-timeline tool call", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "mem-timeline", arguments: { limit: 5 } },
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.result.content[0].type).toBe("text");
	});

	test("handles mem-recall with empty ids", async () => {
		const lines = await callServer([
			{
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "mem-recall", arguments: { ids: [] } },
			},
		]);

		expect(lines.length).toBeGreaterThanOrEqual(1);
		const response = JSON.parse(lines[0]);
		expect(response.result.content[0].text).toContain("No observation IDs");
	});
});
