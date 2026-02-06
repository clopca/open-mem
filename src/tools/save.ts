// =============================================================================
// open-mem — mem-save Custom Tool
// =============================================================================

import { z } from "zod";
import { estimateTokens } from "../ai/parser";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { ObservationType, ToolDefinition } from "../types";

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
		args: {
			title: z.string().describe("Brief title for the observation (max 80 chars)"),
			type: z
				.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
				.describe("Type of observation"),
			narrative: z.string().describe("Detailed description of what to remember"),
			concepts: z.array(z.string()).optional().describe("Related concepts/tags"),
			files: z.array(z.string()).optional().describe("Related file paths"),
		},
		execute: async (args, context) => {
			try {
				const title = args.title as string;
				const type = args.type as ObservationType;
				const narrative = args.narrative as string;
				const concepts = (args.concepts as string[]) ?? [];
				const files = (args.files as string[]) ?? [];

				sessions.getOrCreate(context.sessionID, projectPath);

				const observation = observations.create({
					sessionId: context.sessionID,
					type,
					title,
					subtitle: "",
					facts: [],
					narrative,
					concepts,
					filesRead: [],
					filesModified: files,
					rawToolOutput: `[Manual save] ${narrative}`,
					toolName: "mem-save",
					tokenCount: estimateTokens(`${title} ${narrative}`),
				});

				sessions.incrementObservationCount(context.sessionID);

				return `Saved observation: [${type}] "${title}" (ID: ${observation.id})`;
			} catch (error) {
				return `Save error: ${error}`;
			}
		},
	};
}
