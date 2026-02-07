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
	id: string | number;
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

export interface McpServerDeps {
	observations: ObservationRepository;
	sessions: SessionRepository;
	summaries: SummaryRepository;
	projectPath: string;
	version: string;
}

export class McpServer {
	private observations: ObservationRepository;
	private sessions: SessionRepository;
	private summaries: SummaryRepository;
	private projectPath: string;
	private version: string;

	constructor(deps: McpServerDeps) {
		this.observations = deps.observations;
		this.sessions = deps.sessions;
		this.summaries = deps.summaries;
		this.projectPath = deps.projectPath;
		this.version = deps.version;
	}

	// ---------------------------------------------------------------------------
	// Start listening on stdin/stdout
	// ---------------------------------------------------------------------------

	start(): void {
		const rl = createInterface({
			input: process.stdin,
			terminal: false,
		});

		rl.on("line", (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;

			try {
				const message = JSON.parse(trimmed) as JsonRpcRequest;
				this.handleMessage(message);
			} catch {
				// Malformed JSON — send parse error if we can
				this.sendResponse({
					jsonrpc: "2.0",
					id: 0,
					error: { code: -32700, message: "Parse error" },
				});
			}
		});

		rl.on("close", () => {
			process.exit(0);
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
			case "tools/call":
				this.handleToolsCall(id, msg.params);
				break;
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

	private handleToolsCall(id: string | number, params?: Record<string, unknown>): void {
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
			const result = this.executeTool(toolName, toolArgs);
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
		];
	}

	// ---------------------------------------------------------------------------
	// Tool Execution
	// ---------------------------------------------------------------------------

	private executeTool(name: string, args: Record<string, unknown>): McpToolResult {
		switch (name) {
			case "mem-search":
				return this.execSearch(args);
			case "mem-recall":
				return this.execRecall(args);
			case "mem-timeline":
				return this.execTimeline(args);
			case "mem-save":
				return this.execSave(args);
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

	private execSearch(args: Record<string, unknown>): McpToolResult {
		const query = typeof args.query === "string" ? args.query : undefined;
		const type = typeof args.type === "string" ? (args.type as ObservationType) : undefined;
		const limit = typeof args.limit === "number" ? args.limit : 10;

		if (!query) {
			return {
				content: [{ type: "text", text: "Missing required argument: query" }],
				isError: true,
			};
		}

		try {
			const results = this.observations.search({ query, type, limit });

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
		const ids = Array.isArray(args.ids) ? (args.ids as string[]) : undefined;
		const limit = typeof args.limit === "number" ? args.limit : 10;

		if (!ids || !Array.isArray(ids) || ids.length === 0) {
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
		const limit = typeof args.limit === "number" ? args.limit : 5;
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
		const type = typeof args.type === "string" ? (args.type as ObservationType) : undefined;
		const narrative = typeof args.narrative === "string" ? args.narrative : undefined;
		const concepts = Array.isArray(args.concepts) ? (args.concepts as string[]) : [];
		const files = Array.isArray(args.files) ? (args.files as string[]) : [];

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
