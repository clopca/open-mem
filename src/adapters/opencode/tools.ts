import { fail, ok, toolSchemas } from "../../contracts/api";
import type { MemoryEngine } from "../../core/contracts";
import type { SearchResult, ToolDefinition } from "../../types";

function toJson(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function mapSearchResults(results: SearchResult[], scope: "project" | "user" | "all") {
	return results
		.filter((r) =>
			scope === "all" ? true : scope === "user" ? r.source === "user" : r.source !== "user",
		)
		.map((r) => ({
			id: r.observation.id,
			title: r.observation.title,
			type: r.observation.type,
			summary: r.observation.narrative,
			snippet: r.snippet,
			score: r.rank,
			source: r.source ?? "project",
			createdAt: r.observation.createdAt,
		}));
}

export function createOpenCodeTools(engine: MemoryEngine): Record<string, ToolDefinition> {
	return {
		"memory.find": {
			description: "Find relevant memories by query with optional filtering.",
			args: toolSchemas.find.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.find.parse(rawArgs);
					const results = await engine.search(args.query, {
						limit: args.limit,
						type: args.types?.[0],
					});
					const payload = ok({
						results: mapSearchResults(results, args.scope),
						nextCursor: null,
					});
					return toJson(payload);
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid find arguments", String(error)));
				}
			},
		},
		"memory.history": {
			description: "Browse session history and summaries.",
			args: toolSchemas.history.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.history.parse(rawArgs);
					const rows = await engine.timeline({ limit: args.limit, sessionId: args.sessionId });
					return toJson(ok({ items: rows, nextCursor: null }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid history arguments", String(error)));
				}
			},
		},
		"memory.get": {
			description: "Get full memory records by ID.",
			args: toolSchemas.get.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.get.parse(rawArgs);
					const observations = await engine.recall(args.ids, args.limit);
					return toJson(ok({ observations }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid get arguments", String(error)));
				}
			},
		},
		"memory.create": {
			description: "Create a memory record.",
			args: toolSchemas.create.shape,
			execute: async (rawArgs, context) => {
				try {
					const args = toolSchemas.create.parse(rawArgs);
					const created = await engine.save({ ...args, sessionId: context.sessionID });
					if (!created) return toJson(fail("CONFLICT", "Unable to create memory"));
					return toJson(ok({ observation: created }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid create arguments", String(error)));
				}
			},
		},
		"memory.revise": {
			description: "Create a new revision for an existing memory.",
			args: toolSchemas.revise.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.revise.parse(rawArgs);
					const updated = await engine.update(args);
					if (!updated) return toJson(fail("NOT_FOUND", `Observation ${args.id} not found`));
					return toJson(ok({ previousId: args.id, newId: updated.id, observation: updated }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid revise arguments", String(error)));
				}
			},
		},
		"memory.remove": {
			description: "Tombstone a memory record.",
			args: toolSchemas.remove.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.remove.parse(rawArgs);
					const deleted = await engine.delete([args.id]);
					if (deleted === 0) return toJson(fail("NOT_FOUND", `Observation ${args.id} not found`));
					return toJson(ok({ id: args.id, tombstoned: true }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid remove arguments", String(error)));
				}
			},
		},
		"memory.transfer.export": {
			description: "Export project memory as JSON payload.",
			args: toolSchemas.transferExport.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.transferExport.parse(rawArgs);
					const data = await engine.export("project", { type: args.type, limit: args.limit });
					return toJson(ok({ payload: data, format: args.format }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid export arguments", String(error)));
				}
			},
		},
		"memory.transfer.import": {
			description: "Import memory payload.",
			args: toolSchemas.transferImport.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.transferImport.parse(rawArgs);
					const mode = args.mode === "replace" ? "overwrite" : "skip-duplicates";
					const result = await engine.import(args.payload, { mode });
					return toJson(
						ok({ imported: result.imported, skipped: result.skipped, mode: args.mode }),
					);
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid import arguments", String(error)));
				}
			},
		},
		"memory.maintenance": {
			description: "Run memory maintenance actions.",
			args: toolSchemas.maintenance.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.maintenance.parse(rawArgs);
					if (args.action === "folderContextDryRun") {
						return toJson(ok(await engine.maintainFolderContext("clean", true)));
					}
					if (args.action === "folderContextClean") {
						return toJson(ok(await engine.maintainFolderContext("clean", false)));
					}
					return toJson(ok(await engine.maintainFolderContext("rebuild", false)));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid maintenance arguments", String(error)));
				}
			},
		},
		"memory.help": {
			description: "Show memory workflow guidance.",
			args: toolSchemas.help.shape,
			execute: async () => toJson(ok({ guide: engine.guide() })),
		},
	};
}
