// =============================================================================
// open-mem — mem-save Custom Tool
// =============================================================================

import { z } from "zod";
import { estimateTokens } from "../ai/parser";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { UserObservationRepository } from "../db/user-memory";
import type { ToolDefinition } from "../types";

const saveArgsSchema = z.object({
	title: z.string().describe("Brief title for the observation (max 80 chars)"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.describe("Type of observation"),
	narrative: z.string().describe("Detailed description of what to remember"),
	concepts: z.array(z.string()).optional().describe("Related concepts/tags"),
	files: z.array(z.string()).optional().describe("Related file paths"),
	importance: z
		.number()
		.int()
		.min(1)
		.max(5)
		.optional()
		.describe("Importance score (1-5, default 3)"),
	scope: z
		.enum(["project", "user"])
		.optional()
		.default("project")
		.describe(
			"Memory scope: 'project' (default) saves to project DB, 'user' saves to cross-project user DB",
		),
});

type SaveArgs = z.infer<typeof saveArgsSchema>;

/** Create the mem-save tool for manually saving observations to project or user memory. */
export function createSaveTool(
	observations: ObservationRepository,
	sessions: SessionRepository,
	projectPath: string,
	userObservationRepo?: UserObservationRepository,
): ToolDefinition {
	return {
		description: `Manually save an observation to memory.
Use this to explicitly record important decisions, discoveries, or context
that should be remembered across sessions.
Set scope to "user" to save cross-project memories accessible from any project.`,
		args: saveArgsSchema.shape,
		execute: async (rawArgs, context) => {
			try {
				const args: SaveArgs = saveArgsSchema.parse(rawArgs);

				// Save to user-level DB when scope is "user"
				if (args.scope === "user") {
					if (!userObservationRepo) {
						return "Save error: User-level memory is not enabled. Set OPEN_MEM_USER_MEMORY=true to enable.";
					}
					const userObs = userObservationRepo.create({
						type: args.type,
						title: args.title,
						subtitle: "",
						facts: [],
						narrative: args.narrative,
						concepts: args.concepts ?? [],
						filesRead: [],
						filesModified: args.files ?? [],
						toolName: "mem-save",
						tokenCount: estimateTokens(`${args.title} ${args.narrative}`),
						importance: args.importance ?? 3,
						sourceProject: projectPath,
					});
					return `Saved user-level observation: [${args.type}] "${args.title}" (ID: ${userObs.id}, scope: user)`;
				}

				// Default: save to project-level DB
				sessions.getOrCreate(context.sessionID, projectPath);

				const observation = observations.create({
					sessionId: context.sessionID,
					type: args.type,
					title: args.title,
					subtitle: "",
					facts: [],
					narrative: args.narrative,
					concepts: args.concepts ?? [],
					filesRead: [],
					filesModified: args.files ?? [],
					rawToolOutput: `[Manual save] ${args.narrative}`,
					toolName: "mem-save",
					tokenCount: estimateTokens(`${args.title} ${args.narrative}`),
					discoveryTokens: 0,
					importance: args.importance ?? 3,
				});

				sessions.incrementObservationCount(context.sessionID);

				return `Saved observation: [${args.type}] "${args.title}" (ID: ${observation.id})`;
			} catch (error) {
				return `Save error: ${error}`;
			}
		},
	};
}
