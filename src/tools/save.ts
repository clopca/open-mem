// =============================================================================
// open-mem — mem-save Custom Tool
// =============================================================================

import { z } from "zod";
import { estimateTokens } from "../ai/parser";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { ToolDefinition } from "../types";

const saveArgsSchema = z.object({
	title: z.string().describe("Brief title for the observation (max 80 chars)"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.describe("Type of observation"),
	narrative: z.string().describe("Detailed description of what to remember"),
	concepts: z.array(z.string()).optional().describe("Related concepts/tags"),
	files: z.array(z.string()).optional().describe("Related file paths"),
});

type SaveArgs = z.infer<typeof saveArgsSchema>;

export function createSaveTool(
	observations: ObservationRepository,
	sessions: SessionRepository,
	projectPath: string,
): ToolDefinition {
	return {
		name: "mem-save",
		description: `Manually save an observation to memory.
Use this to explicitly record important decisions, discoveries, or context
that should be remembered across sessions.`,
		args: saveArgsSchema.shape,
		execute: async (rawArgs, context) => {
			try {
				const args: SaveArgs = saveArgsSchema.parse(rawArgs);

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
				});

				sessions.incrementObservationCount(context.sessionID);

				return `Saved observation: [${args.type}] "${args.title}" (ID: ${observation.id})`;
			} catch (error) {
				return `Save error: ${error}`;
			}
		},
	};
}
