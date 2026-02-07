// =============================================================================
// open-mem — MCP Server (Model Context Protocol over JSON-RPC 2.0)
// =============================================================================
//
// Implements the MCP protocol directly over stdin/stdout using newline-delimited
// JSON-RPC 2.0 messages. No external SDK dependencies.
// =============================================================================

import { createInterface } from "node:readline";
import { estimateTokens } from "../ai/parser";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { SearchOrchestrator } from "../search/orchestrator";
import type { ObservationType, SearchResult, SessionSummary } from "../types";

// -----------------------------------------------------------------------------
// JSON-RPC Types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// MCP Tool Schema Types
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// MCP Server
// -----------------------------------------------------------------------------

/** Dependencies required to initialize the MCP server. */
export interface McpServerDeps {
	observations: ObservationRepository;
	sessions: SessionRepository;
	summaries: SummaryRepository;
	searchOrchestrator?: SearchOrchestrator;
	projectPath: string;
	version: string;
}

// -----------------------------------------------------------------------------
// Validation Helpers
// -----------------------------------------------------------------------------

const VALID_OBS_TYPES = new Set<string>([
	"decision",
	"bugfix",
	"feature",
	"refactor",
	"discovery",
	"change",
]);

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return obj.jsonrpc === "2.0" && typeof obj.method === "string";
}

function toObservationType(value: unknown): ObservationType | undefined {
	return typeof value === "string" && VALID_OBS_TYPES.has(value)
		? (value as ObservationType)
		: undefined;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/**
 * MCP server exposing memory tools over stdin/stdout JSON-RPC 2.0.
 * Implements the Model Context Protocol for any MCP-compatible AI client.
 */
export class McpServer {
	private observations: ObservationRepository;
	private sessions: SessionRepository;
	private summaries: SummaryRepository;
	private searchOrchestrator: SearchOrchestrator | null;
	private projectPath: string;
	private version: string;
	private pendingOps: Promise<void>[] = [];

	constructor(deps: McpServerDeps) {
		this.observations = deps.observations;
		this.sessions = deps.sessions;
		this.summaries = deps.summaries;
		this.searchOrchestrator = deps.searchOrchestrator ?? null;
		this.projectPath = deps.projectPath;
		this.version = deps.version;
	}

	// ---------------------------------------------------------------------------
	// Start listening on stdin/stdout
	// ---------------------------------------------------------------------------

	/** Start listening for JSON-RPC messages on stdin. */
	start(): void {
		const rl = createInterface({
			input: process.stdin,
			terminal: false,
		});

		rl.on("line", (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;

			try {
				const parsed: unknown = JSON.parse(trimmed);
				if (isJsonRpcRequest(parsed)) {
					this.handleMessage(parsed);
				} else {
					this.sendResponse({
						jsonrpc: "2.0",
						id: null,
						error: { code: -32600, message: "Invalid Request" },
					});
				}
			} catch {
				this.sendResponse({
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Parse error" },
				});
			}
		});

		rl.on("close", () => {
			Promise.allSettled(this.pendingOps).then(() => {
				process.exit(0);
			});
		});
	}

	// ---------------------------------------------------------------------------
	// Message Router
	// ---------------------------------------------------------------------------

	private handleMessage(msg: JsonRpcRequest): void {
		// Notifications have no id — don't send a response
		if (msg.id === undefined || msg.id === null) {
			return;
		}

		const id = msg.id;

		switch (msg.method) {
			case "initialize":
				this.handleInitialize(id);
				break;
			case "tools/list":
				this.handleToolsList(id);
				break;
			case "tools/call": {
				const op = this.handleToolsCall(id, msg.params);
				this.pendingOps.push(op);
				op.finally(() => {
					const idx = this.pendingOps.indexOf(op);
					if (idx >= 0) this.pendingOps.splice(idx, 1);
				});
				break;
			}
			case "ping":
				this.sendResponse({ jsonrpc: "2.0", id, result: {} });
				break;
			default:
				this.sendResponse({
					jsonrpc: "2.0",
					id,
					error: { code: -32601, message: `Method not found: ${msg.method}` },
				});
		}
	}

	// ---------------------------------------------------------------------------
	// initialize
	// ---------------------------------------------------------------------------

	private handleInitialize(id: string | number): void {
		this.sendResponse({
			jsonrpc: "2.0",
			id,
			result: {
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: {},
				},
				serverInfo: {
					name: "open-mem",
					version: this.version,
				},
			},
		});
	}

	// ---------------------------------------------------------------------------
	// tools/list
	// ---------------------------------------------------------------------------

	private handleToolsList(id: string | number): void {
		this.sendResponse({
			jsonrpc: "2.0",
			id,
			result: {
				tools: this.getToolDefinitions(),
			},
		});
	}

	// ---------------------------------------------------------------------------
	// tools/call
	// ---------------------------------------------------------------------------

	private async handleToolsCall(id: string | number, params?: Record<string, unknown>): Promise<void> {
		const toolName = typeof params?.name === "string" ? params.name : undefined;
		const toolArgs =
			params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
				? (params.arguments as Record<string, unknown>)
				: {};

		if (!toolName) {
			this.sendResponse({
				jsonrpc: "2.0",
				id,
				error: { code: -32602, message: "Missing tool name" },
			});
			return;
		}

		try {
			const result = await this.executeTool(toolName, toolArgs);
			this.sendResponse({
				jsonrpc: "2.0",
				id,
				result,
			});
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : String(err);
			this.sendResponse({
				jsonrpc: "2.0",
				id,
				result: {
					content: [{ type: "text", text: `Error: ${errorMessage}` }],
					isError: true,
				} satisfies McpToolResult,
			});
		}
	}

	// ---------------------------------------------------------------------------
	// Tool Definitions
	// ---------------------------------------------------------------------------

	private getToolDefinitions(): McpToolDefinition[] {
		return [
			{
				name: "mem-search",
				description:
					"Search through past coding session observations and memories. Supports full-text search with FTS5 across observations and session summaries.",
				inputSchema: {
					type: "object",
					properties: {
						query: {
							type: "string",
							description: "Search query (supports keywords, phrases, file paths)",
						},
						type: {
							type: "string",
							enum: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
							description: "Filter by observation type",
						},
						limit: {
							type: "number",
							description: "Maximum number of results (1-50, default: 10)",
						},
					},
					required: ["query"],
				},
			},
			{
				name: "mem-recall",
				description:
					"Fetch full observation details by ID. Use after mem-search to get complete narratives, facts, concepts, and file lists for specific observations.",
				inputSchema: {
					type: "object",
					properties: {
						ids: {
							type: "array",
							items: { type: "string" },
							description: "Observation IDs to fetch",
						},
						limit: {
							type: "number",
							description: "Maximum number of results (1-50, default: 10)",
						},
					},
					required: ["ids"],
				},
			},
			{
				name: "mem-timeline",
				description:
					"View a timeline of past coding sessions for this project. Shows recent sessions with summaries, observation counts, and key decisions.",
				inputSchema: {
					type: "object",
					properties: {
						limit: {
							type: "number",
							description: "Number of recent sessions to show (1-20, default: 5)",
						},
						sessionId: {
							type: "string",
							description: "Show details for a specific session ID",
						},
					},
				},
			},
			{
				name: "mem-save",
				description:
					"Manually save an observation to memory. Use this to explicitly record important decisions, discoveries, or context that should be remembered across sessions.",
				inputSchema: {
					type: "object",
					properties: {
						title: {
							type: "string",
							description: "Brief title for the observation (max 80 chars)",
						},
						type: {
							type: "string",
							enum: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
							description: "Type of observation",
						},
						narrative: {
							type: "string",
							description: "Detailed description of what to remember",
						},
						concepts: {
							type: "array",
							items: { type: "string" },
							description: "Related concepts/tags",
						},
						files: {
							type: "array",
							items: { type: "string" },
							description: "Related file paths",
						},
					},
					required: ["title", "type", "narrative"],
				},
			},
			{
				name: "mem-export",
				description:
					"Export project memories (observations and session summaries) as portable JSON. Use this to back up memories, transfer them between machines, or share context across environments.",
				inputSchema: {
					type: "object",
					properties: {
						type: {
							type: "string",
							enum: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
							description: "Filter by observation type",
						},
						limit: {
							type: "number",
							description: "Maximum number of observations to export",
						},
					},
				},
			},
			{
				name: "mem-import",
				description:
					"Import observations and session summaries from a JSON export. Use this to restore memories from a backup, or import memories from another machine. Skips duplicate observations (by ID) and summaries (by session ID).",
				inputSchema: {
					type: "object",
					properties: {
						data: {
							type: "string",
							description: "JSON string from a mem-export output",
						},
					},
					required: ["data"],
				},
			},
			{
				name: "mem-update",
				description:
					"Update an existing observation in memory. Use this to correct or refine previously saved observations. Only observations belonging to the current project can be updated.",
				inputSchema: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "Observation ID to update",
						},
						title: {
							type: "string",
							description: "Updated title (max 80 chars)",
						},
						narrative: {
							type: "string",
							description: "Updated narrative description",
						},
						type: {
							type: "string",
							enum: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
							description: "Updated observation type",
						},
						concepts: {
							type: "array",
							items: { type: "string" },
							description: "Updated concepts/tags",
						},
						importance: {
							type: "number",
							description: "Updated importance score (1-5)",
						},
					},
					required: ["id"],
				},
			},
			{
				name: "mem-delete",
				description:
					"Delete an observation from memory. Use this to remove incorrect, outdated, or duplicate observations. Only observations belonging to the current project can be deleted.",
				inputSchema: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "Observation ID to delete",
						},
					},
					required: ["id"],
				},
			},
		];
	}

	// ---------------------------------------------------------------------------
	// Tool Execution
	// ---------------------------------------------------------------------------

	private async executeTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
		switch (name) {
			case "mem-search":
				return this.execSearch(args);
			case "mem-recall":
				return this.execRecall(args);
			case "mem-timeline":
				return this.execTimeline(args);
			case "mem-save":
				return this.execSave(args);
			case "mem-export":
				return this.execExport(args);
			case "mem-import":
				return this.execImport(args);
			case "mem-update":
				return this.execUpdate(args);
			case "mem-delete":
				return this.execDelete(args);
			default:
				return {
					content: [{ type: "text", text: `Unknown tool: ${name}` }],
					isError: true,
				};
		}
	}

	// ---------------------------------------------------------------------------
	// mem-search
	// ---------------------------------------------------------------------------

	private async execSearch(args: Record<string, unknown>): Promise<McpToolResult> {
		const query = typeof args.query === "string" ? args.query : undefined;
		const type = toObservationType(args.type);
		const limit = typeof args.limit === "number" ? Math.max(1, Math.min(args.limit, 50)) : 10;

		if (!query) {
			return {
				content: [{ type: "text", text: "Missing required argument: query" }],
				isError: true,
			};
		}

		try {
			let results: SearchResult[];

			if (this.searchOrchestrator) {
				results = await this.searchOrchestrator.search(query, {
					type,
					limit,
					projectPath: this.projectPath,
				});
			} else {
				results = this.observations.search({ query, type, limit, projectPath: this.projectPath });
			}

			if (results.length === 0) {
				const summaryResults = this.summaries.search(query, limit);
				if (summaryResults.length === 0) {
					return {
						content: [
							{ type: "text", text: "No matching observations or session summaries found." },
						],
					};
				}
				return { content: [{ type: "text", text: formatSummaryResults(summaryResults) }] };
			}

			return { content: [{ type: "text", text: formatSearchResults(results) }] };
		} catch (error) {
			return { content: [{ type: "text", text: `Search error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// mem-recall
	// ---------------------------------------------------------------------------

	private execRecall(args: Record<string, unknown>): McpToolResult {
		const ids = toStringArray(args.ids);
		const limit = typeof args.limit === "number" ? Math.max(1, Math.min(args.limit, 50)) : 10;

		if (ids.length === 0) {
			return { content: [{ type: "text", text: "No observation IDs provided." }] };
		}

		try {
			const idsToFetch = ids.slice(0, limit);
			const results: string[] = [];

			for (const id of idsToFetch) {
				const obs = this.observations.getById(id);
				if (obs) {
					const lines: string[] = [];
					lines.push(`## [${obs.type.toUpperCase()}] ${obs.title}`);
					if (obs.subtitle) lines.push(`*${obs.subtitle}*`);
					lines.push(`\n${obs.narrative}`);
					if (obs.facts.length > 0) {
						lines.push("\n**Facts:**");
						for (const f of obs.facts) lines.push(`- ${f}`);
					}
					if (obs.concepts.length > 0) {
						lines.push(`\n**Concepts:** ${obs.concepts.join(", ")}`);
					}
					if (obs.filesRead.length > 0) {
						lines.push(`**Files read:** ${obs.filesRead.join(", ")}`);
					}
					if (obs.filesModified.length > 0) {
						lines.push(`**Files modified:** ${obs.filesModified.join(", ")}`);
					}
					lines.push(`\n*ID: ${obs.id} | Created: ${obs.createdAt} | Tokens: ${obs.tokenCount}*`);
					results.push(lines.join("\n"));
				} else {
					results.push(`## ID: ${id}\n*Not found*`);
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `Recalled ${results.length} observation(s):\n\n${results.join("\n---\n")}`,
					},
				],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Recall error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// mem-timeline
	// ---------------------------------------------------------------------------

	private execTimeline(args: Record<string, unknown>): McpToolResult {
		const limit = typeof args.limit === "number" ? Math.max(1, Math.min(args.limit, 20)) : 5;
		const sessionId = typeof args.sessionId === "string" ? args.sessionId : undefined;

		try {
			if (sessionId) {
				const session = this.sessions.getById(sessionId);
				if (!session) {
					return { content: [{ type: "text", text: `Session ${sessionId} not found.` }] };
				}

				const summary = session.summaryId ? this.summaries.getBySessionId(sessionId) : null;
				const obs = this.observations.getBySession(sessionId);

				const lines: string[] = [`# Session Detail: ${sessionId}\n`];
				lines.push(`- **Started**: ${session.startedAt}`);
				lines.push(`- **Ended**: ${session.endedAt ?? "Active"}`);
				lines.push(`- **Status**: ${session.status}`);
				lines.push(`- **Observations**: ${session.observationCount}`);

				if (summary) {
					lines.push(`\n## Summary\n${summary.summary}`);
					if (summary.keyDecisions.length > 0) {
						lines.push("\n**Key decisions:**");
						for (const d of summary.keyDecisions) lines.push(`- ${d}`);
					}
				}

				if (obs.length > 0) {
					lines.push("\n## Observations");
					for (const o of obs) {
						lines.push(`\n### [${o.type.toUpperCase()}] ${o.title}`);
						lines.push(o.narrative);
						if (o.concepts.length > 0) {
							lines.push(`*Concepts: ${o.concepts.join(", ")}*`);
						}
					}
				}

				return { content: [{ type: "text", text: lines.join("\n") }] };
			}

			const recent = this.sessions.getRecent(this.projectPath, limit);
			if (recent.length === 0) {
				return { content: [{ type: "text", text: "No past sessions found for this project." }] };
			}

			const lines: string[] = [`# Session Timeline (${recent.length} sessions)\n`];

			for (const session of recent) {
				const summary = session.summaryId ? this.summaries.getBySessionId(session.id) : null;

				lines.push(`## Session: ${session.id}`);
				lines.push(`- **Started**: ${session.startedAt}`);
				lines.push(`- **Status**: ${session.status}`);
				lines.push(`- **Observations**: ${session.observationCount}`);

				if (summary) {
					lines.push(`- **Summary**: ${summary.summary}`);
					if (summary.keyDecisions.length > 0) {
						lines.push(`- **Key decisions**: ${summary.keyDecisions.join("; ")}`);
					}
				}

				lines.push("");
			}

			return { content: [{ type: "text", text: lines.join("\n") }] };
		} catch (error) {
			return { content: [{ type: "text", text: `Timeline error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// mem-save
	// ---------------------------------------------------------------------------

	private execSave(args: Record<string, unknown>): McpToolResult {
		const title = typeof args.title === "string" ? args.title : undefined;
		const type = toObservationType(args.type);
		const narrative = typeof args.narrative === "string" ? args.narrative : undefined;
		const concepts = toStringArray(args.concepts);
		const files = toStringArray(args.files);

		if (!title || !type || !narrative) {
			return {
				content: [{ type: "text", text: "Missing required arguments: title, type, narrative" }],
				isError: true,
			};
		}

		try {
			// Use a synthetic session for MCP saves
			const sessionId = `mcp-${new Date().toISOString().slice(0, 10)}`;
			this.sessions.getOrCreate(sessionId, this.projectPath);

			const observation = this.observations.create({
				sessionId,
				type,
				title,
				subtitle: "",
				facts: [],
				narrative,
				concepts,
				filesRead: [],
				filesModified: files,
				rawToolOutput: `[MCP save] ${narrative}`,
				toolName: "mem-save",
				tokenCount: estimateTokens(`${title} ${narrative}`),
				discoveryTokens: 0,
				importance: 3,
			});

			this.sessions.incrementObservationCount(sessionId);

			return {
				content: [
					{ type: "text", text: `Saved observation: [${type}] "${title}" (ID: ${observation.id})` },
				],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Save error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// mem-export
	// ---------------------------------------------------------------------------

	private execExport(args: Record<string, unknown>): McpToolResult {
		const type = toObservationType(args.type);
		const limit = typeof args.limit === "number" ? Math.max(1, args.limit) : undefined;

		try {
			const projectSessions = this.sessions.getAll(this.projectPath);
			if (projectSessions.length === 0) {
				return {
					content: [
						{ type: "text", text: "No sessions found for this project. Nothing to export." },
					],
				};
			}

			let allObservations: Array<Record<string, unknown>> = [];
			for (const session of projectSessions) {
				const obs = this.observations.getBySession(session.id);
				for (const o of obs) {
					const { rawToolOutput: _raw, ...rest } = o;
					allObservations.push(rest as unknown as Record<string, unknown>);
				}
			}

			if (type) {
				allObservations = allObservations.filter((obs) => obs.type === type);
			}

			allObservations.sort((a, b) => {
				const aDate = String(a.createdAt ?? "");
				const bDate = String(b.createdAt ?? "");
				return aDate.localeCompare(bDate);
			});

			if (limit && limit < allObservations.length) {
				allObservations = allObservations.slice(0, limit);
			}

			const allSummaries: SessionSummary[] = [];
			for (const session of projectSessions) {
				const summary = this.summaries.getBySessionId(session.id);
				if (summary) {
					allSummaries.push(summary);
				}
			}

			const exportData = {
				version: 1,
				exportedAt: new Date().toISOString(),
				project: this.projectPath,
				observations: allObservations,
				summaries: allSummaries,
			};

			const json = JSON.stringify(exportData, null, 2);

			return {
				content: [
					{
						type: "text",
						text: `Exported ${allObservations.length} observation(s) and ${allSummaries.length} summary(ies).\n\n${json}`,
					},
				],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Export error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// mem-import
	// ---------------------------------------------------------------------------

	private execImport(args: Record<string, unknown>): McpToolResult {
		const data = typeof args.data === "string" ? args.data : undefined;

		if (!data) {
			return {
				content: [{ type: "text", text: "Missing required argument: data" }],
				isError: true,
			};
		}

		try {
			let parsed: unknown;
			try {
				parsed = JSON.parse(data);
			} catch {
				return {
					content: [
						{
							type: "text",
							text: "Import error: Invalid JSON. Please provide valid JSON from a mem-export.",
						},
					],
					isError: true,
				};
			}

			if (typeof parsed !== "object" || parsed === null) {
				return {
					content: [{ type: "text", text: "Import error: Invalid JSON structure." }],
					isError: true,
				};
			}

			const importData = parsed as Record<string, unknown>;

			if (!importData.version || typeof importData.version !== "number") {
				return {
					content: [
						{
							type: "text",
							text: "Import error: Missing or invalid 'version' field. This doesn't look like a mem-export file.",
						},
					],
					isError: true,
				};
			}

			if (importData.version !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `Import error: Unsupported export version ${importData.version}. This tool supports version 1.`,
						},
					],
					isError: true,
				};
			}

			if (!Array.isArray(importData.observations)) {
				return {
					content: [
						{ type: "text", text: "Import error: Missing or invalid 'observations' array." },
					],
					isError: true,
				};
			}

			let imported = 0;
			let skipped = 0;
			let summariesImported = 0;
			let summariesSkipped = 0;

			const observations = importData.observations as Array<Record<string, unknown>>;
			for (const obs of observations) {
				const id = typeof obs.id === "string" ? obs.id : undefined;
				const sessionId = typeof obs.sessionId === "string" ? obs.sessionId : undefined;
				const obsType = typeof obs.type === "string" ? obs.type : undefined;
				const title = typeof obs.title === "string" ? obs.title : undefined;
				const createdAt = typeof obs.createdAt === "string" ? obs.createdAt : undefined;

				if (!id || !sessionId || !obsType || !title || !createdAt) {
					skipped++;
					continue;
				}

				const existing = this.observations.getById(id);
				if (existing) {
					skipped++;
					continue;
				}

				this.sessions.getOrCreate(sessionId, this.projectPath);

				this.observations.importObservation({
					id,
					sessionId,
					type: obsType as ObservationType,
					title,
					subtitle: typeof obs.subtitle === "string" ? obs.subtitle : "",
					facts: Array.isArray(obs.facts) ? (obs.facts as string[]) : [],
					narrative: typeof obs.narrative === "string" ? obs.narrative : "",
					concepts: Array.isArray(obs.concepts) ? (obs.concepts as string[]) : [],
					filesRead: Array.isArray(obs.filesRead) ? (obs.filesRead as string[]) : [],
					filesModified: Array.isArray(obs.filesModified) ? (obs.filesModified as string[]) : [],
					rawToolOutput: typeof obs.rawToolOutput === "string" ? obs.rawToolOutput : "",
					toolName: typeof obs.toolName === "string" ? obs.toolName : "unknown",
					createdAt,
					tokenCount: typeof obs.tokenCount === "number" ? obs.tokenCount : 0,
					discoveryTokens: typeof obs.discoveryTokens === "number" ? obs.discoveryTokens : 0,
					importance: typeof obs.importance === "number" ? obs.importance : 3,
				});

				this.sessions.incrementObservationCount(sessionId);
				imported++;
			}

			const summariesArr = Array.isArray(importData.summaries)
				? (importData.summaries as Array<Record<string, unknown>>)
				: [];
			for (const summary of summariesArr) {
				const summarySessionId =
					typeof summary.sessionId === "string" ? summary.sessionId : undefined;
				const summaryId = typeof summary.id === "string" ? summary.id : undefined;

				if (!summarySessionId || !summaryId) {
					summariesSkipped++;
					continue;
				}

				const existing = this.summaries.getBySessionId(summarySessionId);
				if (existing) {
					summariesSkipped++;
					continue;
				}

				this.sessions.getOrCreate(summarySessionId, this.projectPath);

				this.summaries.importSummary({
					id: summaryId,
					sessionId: summarySessionId,
					summary: typeof summary.summary === "string" ? summary.summary : "",
					keyDecisions: Array.isArray(summary.keyDecisions)
						? (summary.keyDecisions as string[])
						: [],
					filesModified: Array.isArray(summary.filesModified)
						? (summary.filesModified as string[])
						: [],
					concepts: Array.isArray(summary.concepts) ? (summary.concepts as string[]) : [],
					createdAt:
						typeof summary.createdAt === "string" ? summary.createdAt : new Date().toISOString(),
					tokenCount: typeof summary.tokenCount === "number" ? summary.tokenCount : 0,
					request: typeof summary.request === "string" ? summary.request : undefined,
					investigated: typeof summary.investigated === "string" ? summary.investigated : undefined,
					learned: typeof summary.learned === "string" ? summary.learned : undefined,
					completed: typeof summary.completed === "string" ? summary.completed : undefined,
					nextSteps: typeof summary.nextSteps === "string" ? summary.nextSteps : undefined,
				});

				this.sessions.setSummary(summarySessionId, summaryId);
				summariesImported++;
			}

			const parts: string[] = [];
			parts.push(`Imported ${imported} observation(s)`);
			parts.push(`${summariesImported} summary(ies)`);
			if (skipped > 0) parts.push(`Skipped ${skipped} duplicate/invalid observation(s)`);
			if (summariesSkipped > 0) parts.push(`skipped ${summariesSkipped} duplicate summary(ies)`);

			return {
				content: [{ type: "text", text: `${parts.join(". ")}.` }],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Import error: ${error}` }], isError: true };
		}
	}

	private execUpdate(args: Record<string, unknown>): McpToolResult {
		const id = typeof args.id === "string" ? args.id : undefined;
		if (!id) {
			return {
				content: [{ type: "text", text: "Missing required argument: id" }],
				isError: true,
			};
		}

		try {
			const existing = this.observations.getById(id);
			if (!existing) {
				return {
					content: [{ type: "text", text: `Observation "${id}" not found.` }],
					isError: true,
				};
			}

			const session = this.sessions.getById(existing.sessionId);
			if (!session || session.projectPath !== this.projectPath) {
				return {
					content: [{ type: "text", text: `Observation "${id}" not found in this project.` }],
					isError: true,
				};
			}

			const updateData: Record<string, unknown> = {};
			if (typeof args.title === "string") updateData.title = args.title;
			if (typeof args.narrative === "string") updateData.narrative = args.narrative;
			if (typeof args.type === "string" && VALID_OBS_TYPES.has(args.type))
				updateData.type = args.type;
			if (Array.isArray(args.concepts)) updateData.concepts = toStringArray(args.concepts);
			if (typeof args.importance === "number") updateData.importance = args.importance;

			const updated = this.observations.update(
				id,
				updateData as Parameters<typeof this.observations.update>[1],
			);
			if (!updated) {
				return {
					content: [{ type: "text", text: `Failed to update observation "${id}".` }],
					isError: true,
				};
			}

			const changedFields = Object.keys(updateData);
			return {
				content: [
					{
						type: "text",
						text: `Updated observation "${updated.title}" (ID: ${updated.id}). Changed: ${changedFields.join(", ") || "nothing"}.`,
					},
				],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Update error: ${error}` }], isError: true };
		}
	}

	private execDelete(args: Record<string, unknown>): McpToolResult {
		const id = typeof args.id === "string" ? args.id : undefined;
		if (!id) {
			return {
				content: [{ type: "text", text: "Missing required argument: id" }],
				isError: true,
			};
		}

		try {
			const existing = this.observations.getById(id);
			if (!existing) {
				return {
					content: [{ type: "text", text: `Observation "${id}" not found.` }],
					isError: true,
				};
			}

			const session = this.sessions.getById(existing.sessionId);
			if (!session || session.projectPath !== this.projectPath) {
				return {
					content: [{ type: "text", text: `Observation "${id}" not found in this project.` }],
					isError: true,
				};
			}

			const title = existing.title;
			const deleted = this.observations.delete(id);
			if (!deleted) {
				return {
					content: [{ type: "text", text: `Failed to delete observation "${id}".` }],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Deleted observation: [${existing.type}] "${title}" (ID: ${id})`,
					},
				],
			};
		} catch (error) {
			return { content: [{ type: "text", text: `Delete error: ${error}` }], isError: true };
		}
	}

	// ---------------------------------------------------------------------------
	// Response Writer
	// ---------------------------------------------------------------------------

	private sendResponse(response: JsonRpcResponse): void {
		const json = JSON.stringify(response);
		process.stdout.write(`${json}\n`);
	}
}

// =============================================================================
// Formatters (mirroring src/tools/search.ts)
// =============================================================================

function formatSearchResults(results: SearchResult[]): string {
	const lines: string[] = [`Found ${results.length} observation(s):\n`];

	for (const { observation: obs } of results) {
		lines.push(`## [${obs.type.toUpperCase()}] ${obs.title}`);
		if (obs.subtitle) lines.push(`*${obs.subtitle}*`);
		lines.push(`\n${obs.narrative}`);

		if (obs.facts.length > 0) {
			lines.push("\n**Facts:**");
			for (const f of obs.facts) lines.push(`- ${f}`);
		}
		if (obs.concepts.length > 0) {
			lines.push(`\n**Concepts:** ${obs.concepts.join(", ")}`);
		}
		if (obs.filesModified.length > 0) {
			lines.push(`**Files modified:** ${obs.filesModified.join(", ")}`);
		}
		if (obs.filesRead.length > 0) {
			lines.push(`**Files read:** ${obs.filesRead.join(", ")}`);
		}

		lines.push(`\n*Session: ${obs.sessionId} | ${obs.createdAt}*`);
		lines.push("---");
	}

	return lines.join("\n");
}

function formatSummaryResults(results: SessionSummary[]): string {
	const lines: string[] = [`Found ${results.length} session summary(ies):\n`];

	for (const summary of results) {
		lines.push(`## Session: ${summary.sessionId}`);
		lines.push(summary.summary);
		if (summary.keyDecisions.length > 0) {
			lines.push("\n**Key decisions:**");
			for (const d of summary.keyDecisions) lines.push(`- ${d}`);
		}
		lines.push("---");
	}

	return lines.join("\n");
}
