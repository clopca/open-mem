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

describe("McpServer", () => {
	test("initialize negotiates protocol version", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } },
		]);

		const response = JSON.parse(lines[0]);
		expect(response.result.serverInfo.name).toBe("open-mem");
		expect(response.result.protocolVersion).toBe("2024-11-05");
		expect(response.result.capabilities.tools.listChanged).toBe(false);
	});

	test("initialize rejects unsupported protocol version", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } },
		]);

		const response = JSON.parse(lines[0]);
		expect(response.error.code).toBe(-32602);
		expect(response.error.message).toContain("Unsupported protocol version");
	});

	test("strict mode rejects methods before initialize", async () => {
		const lines = await callServer([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
		const response = JSON.parse(lines[0]);
		expect(response.error.code).toBe(-32002);
	});

	test("notifications/initialized is accepted without response", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{ jsonrpc: "2.0", method: "notifications/initialized", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "ping", params: {} },
		]);

		expect(lines.length).toBe(2);
		const pingResponse = JSON.parse(lines[1]);
		expect(pingResponse.id).toBe(2);
		expect(pingResponse.result).toEqual({});
	});

	test("tools/list returns stable memory.* tools and schema", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
		]);

		const response = JSON.parse(lines[1]);
		const toolNames = response.result.tools.map((t: { name: string }) => t.name);
		expect(toolNames).toContain("mem-find");
		expect(toolNames).toContain("mem-create");
		expect(toolNames).toContain("mem-help");

		const findTool = response.result.tools.find((t: { name: string }) => t.name === "mem-find");
		expect(findTool.inputSchema.type).toBe("object");
		expect(findTool.inputSchema.properties).toHaveProperty("query");
		expect(findTool.inputSchema.required).toContain("query");
	});

	test("tools/call validation errors are deterministic", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "mem-find", arguments: { query: "" } },
			},
		]);

		const response = JSON.parse(lines[1]);
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("VALIDATION_ERROR");
		expect(response.result.content[0].text).toContain("query");
	});

	test("unknown tool returns structured NOT_FOUND error", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "memory.unknown", arguments: {} },
			},
		]);

		const response = JSON.parse(lines[1]);
		expect(response.result.isError).toBe(true);
		expect(response.result.content[0].text).toContain("NOT_FOUND");
	});

	test("unknown method returns -32601", async () => {
		const lines = await callServer([
			{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
			{ jsonrpc: "2.0", id: 2, method: "unknown/method", params: {} },
		]);

		const response = JSON.parse(lines[1]);
		expect(response.error.code).toBe(-32601);
	});
});
