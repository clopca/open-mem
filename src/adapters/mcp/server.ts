import { createInterface } from "node:readline";
import type { MemoryEngine } from "../../core/contracts";
import { fail, ok, toolSchemas } from "../../contracts/api";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface McpServerDeps {
  memoryEngine: MemoryEngine;
  version: string;
}

function isRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}

function toSchema(shape: Record<string, unknown>, required: string[] = []): McpToolDefinition["inputSchema"] {
  return { type: "object", properties: shape, required: required.length > 0 ? required : undefined };
}

export class McpServer {
  private readonly memoryEngine: MemoryEngine;
  private readonly version: string;
  private pendingOps: Promise<void>[] = [];

  constructor(deps: McpServerDeps) {
    this.memoryEngine = deps.memoryEngine;
    this.version = deps.version;
  }

  start(): void {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isRequest(parsed)) {
          this.send({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
          return;
        }
        this.handle(parsed);
      } catch {
        this.send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    });

    rl.on("close", () => {
      Promise.allSettled(this.pendingOps).then(() => process.exit(0));
    });
  }

  private handle(msg: JsonRpcRequest): void {
    if (msg.id === undefined || msg.id === null) return;

    switch (msg.method) {
      case "initialize":
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "open-mem", version: this.version },
          },
        });
        return;
      case "tools/list":
        this.send({ jsonrpc: "2.0", id: msg.id, result: { tools: this.getToolDefinitions() } });
        return;
      case "tools/call": {
        const op = this.handleToolCall(msg.id, msg.params);
        this.pendingOps.push(op);
        op.finally(() => {
          this.pendingOps = this.pendingOps.filter((p) => p !== op);
        });
        return;
      }
      case "ping":
        this.send({ jsonrpc: "2.0", id: msg.id, result: {} });
        return;
      default:
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        });
    }
  }

  private getToolDefinitions(): McpToolDefinition[] {
    return [
      { name: "memory.find", description: "Find relevant memory records.", inputSchema: toSchema(toolSchemas.find.shape, ["query"]) },
      { name: "memory.history", description: "Browse session history.", inputSchema: toSchema(toolSchemas.history.shape) },
      { name: "memory.get", description: "Fetch full memory records by id.", inputSchema: toSchema(toolSchemas.get.shape, ["ids"]) },
      { name: "memory.create", description: "Create a memory record.", inputSchema: toSchema(toolSchemas.create.shape, ["title", "type", "narrative"]) },
      { name: "memory.revise", description: "Create a revised memory revision.", inputSchema: toSchema(toolSchemas.revise.shape, ["id"]) },
      { name: "memory.remove", description: "Tombstone a memory record.", inputSchema: toSchema(toolSchemas.remove.shape, ["id"]) },
      { name: "memory.transfer.export", description: "Export memory.", inputSchema: toSchema(toolSchemas.transferExport.shape) },
      { name: "memory.transfer.import", description: "Import memory payload.", inputSchema: toSchema(toolSchemas.transferImport.shape, ["payload"]) },
      { name: "memory.maintenance", description: "Run maintenance action.", inputSchema: toSchema(toolSchemas.maintenance.shape, ["action"]) },
      { name: "memory.help", description: "Show memory workflow guidance.", inputSchema: toSchema(toolSchemas.help.shape) },
    ];
  }

  private async handleToolCall(id: string | number, params?: Record<string, unknown>): Promise<void> {
    const toolName = typeof params?.name === "string" ? params.name : "";
    const toolArgs =
      params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as Record<string, unknown>)
        : {};

    if (!toolName) {
      this.send({ jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } });
      return;
    }

    try {
      const result = await this.executeTool(toolName, toolArgs);
      this.send({ jsonrpc: "2.0", id, result });
    } catch (error) {
      this.send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(fail("INTERNAL_ERROR", String(error))) }], isError: true },
      });
    }
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const text = async () => {
      switch (name) {
        case "memory.find": {
          const parsed = toolSchemas.find.parse(args);
          const results = await this.memoryEngine.search(parsed.query, {
            limit: parsed.limit,
            type: parsed.types?.[0],
          });
          return JSON.stringify(ok({ results }), null, 2);
        }
        case "memory.history": {
          const parsed = toolSchemas.history.parse(args);
          return JSON.stringify(ok({ items: await this.memoryEngine.timeline({ limit: parsed.limit, sessionId: parsed.sessionId }) }), null, 2);
        }
        case "memory.get": {
          const parsed = toolSchemas.get.parse(args);
          return JSON.stringify(ok({ observations: await this.memoryEngine.recall(parsed.ids, parsed.limit) }), null, 2);
        }
        case "memory.create": {
          const parsed = toolSchemas.create.parse(args);
          const created = await this.memoryEngine.save({ ...parsed, sessionId: "mcp" });
          return JSON.stringify(created ? ok({ observation: created }) : fail("CONFLICT", "Unable to create memory"), null, 2);
        }
        case "memory.revise": {
          const parsed = toolSchemas.revise.parse(args);
          const revised = await this.memoryEngine.update(parsed);
          return JSON.stringify(revised ? ok({ previousId: parsed.id, newId: revised.id, observation: revised }) : fail("NOT_FOUND", `Observation ${parsed.id} not found`), null, 2);
        }
        case "memory.remove": {
          const parsed = toolSchemas.remove.parse(args);
          const deleted = await this.memoryEngine.delete([parsed.id]);
          return JSON.stringify(deleted > 0 ? ok({ id: parsed.id, tombstoned: true }) : fail("NOT_FOUND", `Observation ${parsed.id} not found`), null, 2);
        }
        case "memory.transfer.export": {
          const parsed = toolSchemas.transferExport.parse(args);
          const payload = await this.memoryEngine.export("project", { type: parsed.type, limit: parsed.limit });
          return JSON.stringify(ok({ payload, format: parsed.format }), null, 2);
        }
        case "memory.transfer.import": {
          const parsed = toolSchemas.transferImport.parse(args);
          const mode = parsed.mode === "replace" ? "overwrite" : "skip-duplicates";
          const result = await this.memoryEngine.import(parsed.payload, { mode });
          return JSON.stringify(ok({ imported: result.imported, skipped: result.skipped, mode: parsed.mode }), null, 2);
        }
        case "memory.maintenance": {
          const parsed = toolSchemas.maintenance.parse(args);
          if (parsed.action === "folderContextDryRun") return JSON.stringify(ok(await this.memoryEngine.maintainFolderContext("clean", true)), null, 2);
          if (parsed.action === "folderContextClean") return JSON.stringify(ok(await this.memoryEngine.maintainFolderContext("clean", false)), null, 2);
          return JSON.stringify(ok(await this.memoryEngine.maintainFolderContext("rebuild", false)), null, 2);
        }
        case "memory.help":
          return JSON.stringify(ok({ guide: this.memoryEngine.guide() }), null, 2);
        default:
          return JSON.stringify(fail("NOT_FOUND", `Unknown tool: ${name}`), null, 2);
      }
    };

    try {
      return { content: [{ type: "text", text: await text() }] };
    } catch (error) {
      return { content: [{ type: "text", text: JSON.stringify(fail("VALIDATION_ERROR", String(error)), null, 2) }], isError: true };
    }
  }

  private send(response: JsonRpcResponse): void {
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}
