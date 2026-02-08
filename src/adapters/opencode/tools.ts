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
		"mem-find": {
			description:
				"Search past memories — decisions, discoveries, gotchas, and session history. Use to recall context from previous sessions before starting work.",
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
		"mem-history": {
			description:
				"Browse session timeline and summaries. Use to understand what happened in recent sessions or drill into a specific session.",
			args: toolSchemas.history.shape,
			execute: async (rawArgs) => {
				try {
					const args = toolSchemas.history.parse(rawArgs);
					const rows = await engine.timeline({
						limit: args.limit,
						sessionId: args.sessionId,
						anchor: args.anchor,
						depthBefore: args.depthBefore,
						depthAfter: args.depthAfter,
					});
					return toJson(ok({ items: rows, nextCursor: null }));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid history arguments", String(error)));
				}
			},
		},
		"mem-get": {
			description:
				"Fetch full memory details by ID. Use after mem-find or mem-history to get complete narratives, facts, and file lists.",
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
		"mem-create": {
			description:
				"Save an important observation to memory. Use for decisions + rationale, non-obvious gotchas, user preferences, or cross-session plans that auto-capture wouldn't understand the significance of.",
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
		"mem-revise": {
			description:
				"Update an existing memory with a new revision. Use when a previous decision changed, a gotcha was resolved, or information became outdated.",
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
		"mem-remove": {
			description:
				"Tombstone an obsolete or incorrect memory. Use to clean up memories that are no longer accurate or relevant.",
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
		"mem-export": {
			description:
				"Export project memories as portable JSON for backup or transfer between machines.",
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
		"mem-import": {
			description: "Import memories from a JSON export. Skips duplicates by default.",
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
		"mem-maintenance": {
			description:
				"Run folder context maintenance — clean, rebuild, purge, or dry-run AGENTS.md files.",
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
					if (args.action === "folderContextPurge") {
						return toJson(ok(await engine.maintainFolderContext("purge", false)));
					}
					return toJson(ok(await engine.maintainFolderContext("rebuild", false)));
				} catch (error) {
					return toJson(fail("VALIDATION_ERROR", "Invalid maintenance arguments", String(error)));
				}
			},
		},
		"mem-help": {
			description:
				"Show detailed memory workflow guidance including when to save, what to save, and memory type reference.",
			args: toolSchemas.help.shape,
			execute: async () => toJson(ok({ guide: engine.guide() })),
		},
	};
}
