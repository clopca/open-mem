import { createInterface } from "node:readline";
import { z } from "zod";
import { fail, ok, toolSchemas } from "../../contracts/api";
import type { MemoryEngine } from "../../core/contracts";

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
		additionalProperties?: boolean;
	};
}

interface McpToolResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

export interface McpServerDeps {
	memoryEngine: MemoryEngine;
	version: string;
	compatibilityMode?: "strict" | "legacy";
	protocolVersion?: string;
	supportedProtocolVersions?: string[];
}

const DEFAULT_PROTOCOL_VERSION = "2024-11-05";
const TOOL_CALL_PARAMS_SCHEMA = z.object({
	name: z.string().min(1),
	arguments: z.record(z.string(), z.unknown()).optional(),
});

function isRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}

function toInputSchema(schema: z.ZodObject<z.ZodRawShape>): McpToolDefinition["inputSchema"] {
	const asJsonSchema = z.toJSONSchema(schema);
	const out = asJsonSchema as Record<string, unknown>;
	return {
		type: "object",
		properties: (out.properties as Record<string, unknown>) ?? {},
		required: (out.required as string[] | undefined) ?? undefined,
		additionalProperties: false,
	};
}

function asValidationError(error: z.ZodError): string {
	return error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.join(".") : "input";
			return `${path}: ${issue.message}`;
		})
		.join("; ");
}

export class McpServer {
	private readonly memoryEngine: MemoryEngine;
	private readonly version: string;
	private readonly compatibilityMode: "strict" | "legacy";
	private readonly protocolVersion: string;
	private readonly supportedProtocolVersions: string[];
	private initialized = false;
	private pendingOps: Promise<void>[] = [];

	constructor(deps: McpServerDeps) {
		this.memoryEngine = deps.memoryEngine;
		this.version = deps.version;
		this.compatibilityMode = deps.compatibilityMode ?? "strict";
		this.protocolVersion = deps.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
		this.supportedProtocolVersions =
			deps.supportedProtocolVersions && deps.supportedProtocolVersions.length > 0
				? deps.supportedProtocolVersions
				: [this.protocolVersion];
	}

	start(): void {
		const rl = createInterface({ input: process.stdin, terminal: false });
		rl.on("line", (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (!isRequest(parsed)) {
					this.send({
						jsonrpc: "2.0",
						id: null,
						error: { code: -32600, message: "Invalid Request" },
					});
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
		if (msg.method === "notifications/initialized") {
			this.initialized = true;
			return;
		}

		if (msg.id === undefined || msg.id === null) return;

		if (msg.method === "initialize") {
			this.handleInitialize(msg);
			return;
		}

		if (!this.initialized && this.compatibilityMode === "strict") {
			this.send({
				jsonrpc: "2.0",
				id: msg.id,
				error: { code: -32002, message: "Server not initialized" },
			});
			return;
		}

		switch (msg.method) {
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

	private handleInitialize(msg: JsonRpcRequest): void {
		const requested =
			typeof msg.params?.protocolVersion === "string"
				? msg.params.protocolVersion
				: this.protocolVersion;

		if (!this.supportedProtocolVersions.includes(requested)) {
			this.send({
				jsonrpc: "2.0",
				id: msg.id ?? null,
				error: {
					code: -32602,
					message: `Unsupported protocol version: ${requested}`,
					data: { supported: this.supportedProtocolVersions },
				},
			});
			return;
		}

		this.initialized = true;
		this.send({
			jsonrpc: "2.0",
			id: msg.id ?? null,
			result: {
				protocolVersion: requested,
				capabilities: {
					tools: {
						listChanged: false,
					},
				},
				serverInfo: { name: "open-mem", version: this.version },
			},
		});
	}

	private getToolDefinitions(): McpToolDefinition[] {
		return [
			{
				name: "mem-find",
				description:
					"Search past memories — decisions, discoveries, gotchas, and session history. Use to recall context from previous sessions before starting work.",
				inputSchema: toInputSchema(toolSchemas.find),
			},
			{
				name: "mem-history",
				description:
					"Browse session timeline and summaries. Use to understand what happened in recent sessions or drill into a specific session.",
				inputSchema: toInputSchema(toolSchemas.history),
			},
			{
				name: "mem-get",
				description:
					"Fetch full memory details by ID. Use after mem-find or mem-history to get complete narratives, facts, and file lists.",
				inputSchema: toInputSchema(toolSchemas.get),
			},
			{
				name: "mem-create",
				description:
					"Save an important observation to memory. Use for decisions + rationale, non-obvious gotchas, user preferences, or cross-session plans that auto-capture wouldn't understand the significance of.",
				inputSchema: toInputSchema(toolSchemas.create),
			},
			{
				name: "mem-revise",
				description:
					"Update an existing memory with a new revision. Use when a previous decision changed, a gotcha was resolved, or information became outdated.",
				inputSchema: toInputSchema(toolSchemas.revise),
			},
			{
				name: "mem-remove",
				description:
					"Tombstone an obsolete or incorrect memory. Use to clean up memories that are no longer accurate or relevant.",
				inputSchema: toInputSchema(toolSchemas.remove),
			},
			{
				name: "mem-export",
				description:
					"Export project memories as portable JSON for backup or transfer between machines.",
				inputSchema: toInputSchema(toolSchemas.transferExport),
			},
			{
				name: "mem-import",
				description: "Import memories from a JSON export. Skips duplicates by default.",
				inputSchema: toInputSchema(toolSchemas.transferImport),
			},
			{
				name: "mem-maintenance",
				description:
					"Run folder context maintenance — clean, rebuild, purge, or dry-run AGENTS.md files.",
				inputSchema: toInputSchema(toolSchemas.maintenance),
			},
			{
				name: "mem-help",
				description:
					"Show detailed memory workflow guidance including when to save, what to save, and memory type reference.",
				inputSchema: toInputSchema(toolSchemas.help),
			},
		];
	}

	private async handleToolCall(
		id: string | number,
		params?: Record<string, unknown>,
	): Promise<void> {
		const parsed = TOOL_CALL_PARAMS_SCHEMA.safeParse(params ?? {});
		if (!parsed.success) {
			this.send({
				jsonrpc: "2.0",
				id,
				result: {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								fail("VALIDATION_ERROR", asValidationError(parsed.error)),
								null,
								2,
							),
						},
					],
					isError: true,
				},
			});
			return;
		}

		const toolName = parsed.data.name;
		const toolArgs = parsed.data.arguments ?? {};

		try {
			const result = await this.executeTool(toolName, toolArgs);
			this.send({ jsonrpc: "2.0", id, result });
		} catch (error) {
			this.send({
				jsonrpc: "2.0",
				id,
				result: {
					content: [
						{ type: "text", text: JSON.stringify(fail("INTERNAL_ERROR", String(error)), null, 2) },
					],
					isError: true,
				},
			});
		}
	}

	private async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		const text = async () => {
			switch (name) {
				case "mem-find": {
					const parsed = toolSchemas.find.parse(args);
					const results = await this.memoryEngine.search(parsed.query, {
						limit: parsed.limit,
						type: parsed.types?.[0],
					});
					return JSON.stringify(ok({ results }), null, 2);
				}
				case "mem-history": {
					const parsed = toolSchemas.history.parse(args);
					return JSON.stringify(
						ok({
							items: await this.memoryEngine.timeline({
								limit: parsed.limit,
								sessionId: parsed.sessionId,
								anchor: parsed.anchor,
								depthBefore: parsed.depthBefore,
								depthAfter: parsed.depthAfter,
							}),
						}),
						null,
						2,
					);
				}
				case "mem-get": {
					const parsed = toolSchemas.get.parse(args);
					return JSON.stringify(
						ok({ observations: await this.memoryEngine.recall(parsed.ids, parsed.limit) }),
						null,
						2,
					);
				}
				case "mem-create": {
					const parsed = toolSchemas.create.parse(args);
					const created = await this.memoryEngine.save({ ...parsed, sessionId: "mcp" });
					return JSON.stringify(
						created ? ok({ observation: created }) : fail("CONFLICT", "Unable to create memory"),
						null,
						2,
					);
				}
				case "mem-revise": {
					const parsed = toolSchemas.revise.parse(args);
					const revised = await this.memoryEngine.update(parsed);
					return JSON.stringify(
						revised
							? ok({ previousId: parsed.id, newId: revised.id, observation: revised })
							: fail("NOT_FOUND", `Observation ${parsed.id} not found`),
						null,
						2,
					);
				}
				case "mem-remove": {
					const parsed = toolSchemas.remove.parse(args);
					const deleted = await this.memoryEngine.delete([parsed.id]);
					return JSON.stringify(
						deleted > 0
							? ok({ id: parsed.id, tombstoned: true })
							: fail("NOT_FOUND", `Observation ${parsed.id} not found`),
						null,
						2,
					);
				}
				case "mem-export": {
					const parsed = toolSchemas.transferExport.parse(args);
					const payload = await this.memoryEngine.export("project", {
						type: parsed.type,
						limit: parsed.limit,
					});
					return JSON.stringify(ok({ payload, format: parsed.format }), null, 2);
				}
				case "mem-import": {
					const parsed = toolSchemas.transferImport.parse(args);
					const mode = parsed.mode === "replace" ? "overwrite" : "skip-duplicates";
					const result = await this.memoryEngine.import(parsed.payload, { mode });
					return JSON.stringify(
						ok({ imported: result.imported, skipped: result.skipped, mode: parsed.mode }),
						null,
						2,
					);
				}
				case "mem-maintenance": {
					const parsed = toolSchemas.maintenance.parse(args);
					if (parsed.action === "folderContextDryRun") {
						return JSON.stringify(
							ok(await this.memoryEngine.maintainFolderContext("clean", true)),
							null,
							2,
						);
					}
					if (parsed.action === "folderContextClean") {
						return JSON.stringify(
							ok(await this.memoryEngine.maintainFolderContext("clean", false)),
							null,
							2,
						);
					}
					if (parsed.action === "folderContextPurge") {
						return JSON.stringify(
							ok(await this.memoryEngine.maintainFolderContext("purge", false)),
							null,
							2,
						);
					}
					return JSON.stringify(
						ok(await this.memoryEngine.maintainFolderContext("rebuild", false)),
						null,
						2,
					);
				}
				case "mem-help":
					return JSON.stringify(ok({ guide: this.memoryEngine.guide() }), null, 2);
				default:
					return JSON.stringify(fail("NOT_FOUND", `Unknown tool: ${name}`), null, 2);
			}
		};

		try {
			const payload = await text();
			const isError = payload.includes('"error": {') && !payload.includes('"error": null');
			return { content: [{ type: "text", text: payload }], isError };
		} catch (error) {
			if (error instanceof z.ZodError) {
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(fail("VALIDATION_ERROR", asValidationError(error)), null, 2),
						},
					],
					isError: true,
				};
			}
			return {
				content: [
					{ type: "text", text: JSON.stringify(fail("INTERNAL_ERROR", String(error)), null, 2) },
				],
				isError: true,
			};
		}
	}

	private send(response: JsonRpcResponse): void {
		process.stdout.write(`${JSON.stringify(response)}\n`);
	}
}
