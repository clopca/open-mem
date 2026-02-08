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
  test("initialize works", async () => {
    const lines = await callServer([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }]);
    const response = JSON.parse(lines[0]);
    expect(response.result.serverInfo.name).toBe("open-mem");
  });

  test("tools/list returns memory.* tools", async () => {
    const lines = await callServer([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
    const response = JSON.parse(lines[0]);
    const toolNames = response.result.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("memory.find");
    expect(toolNames).toContain("memory.create");
    expect(toolNames).toContain("memory.help");
  });

  test("tools/call memory.find returns content", async () => {
    const lines = await callServer([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "memory.find", arguments: { query: "test" } },
      },
    ]);

    const response = JSON.parse(lines[0]);
    expect(response.result.content[0].type).toBe("text");
    expect(response.result.content[0].text).toContain("results");
  });

  test("missing tool name returns RPC error", async () => {
    const lines = await callServer([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { arguments: {} } },
    ]);
    const response = JSON.parse(lines[0]);
    expect(response.error.message).toContain("Missing tool name");
  });
});
