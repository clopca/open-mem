import { fail, ok, TOOL_CONTRACTS, toolSchemas } from "../../contracts/api";
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
	const descriptions = Object.fromEntries(
		TOOL_CONTRACTS.map((tool) => [tool.name, tool.description]),
	);

	return {
		"mem-find": {
			description: descriptions["mem-find"],
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
			description: descriptions["mem-history"],
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
			description: descriptions["mem-get"],
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
			description: descriptions["mem-create"],
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
			description: descriptions["mem-revise"],
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
			description: descriptions["mem-remove"],
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
			description: descriptions["mem-export"],
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
			description: descriptions["mem-import"],
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
			description: descriptions["mem-maintenance"],
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
			description: descriptions["mem-help"],
			args: toolSchemas.help.shape,
			execute: async () => toJson(ok({ guide: engine.guide() })),
		},
	};
}
