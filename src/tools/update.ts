import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { ToolDefinition } from "../types";

const updateArgsSchema = z.object({
	id: z.string().describe("Observation ID to update"),
	title: z.string().optional().describe("Updated title (max 80 chars)"),
	narrative: z.string().optional().describe("Updated narrative description"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.optional()
		.describe("Updated observation type"),
	concepts: z.array(z.string()).optional().describe("Updated concepts/tags"),
	importance: z.number().int().min(1).max(5).optional().describe("Updated importance score (1-5)"),
});

type UpdateArgs = z.infer<typeof updateArgsSchema>;

/** Create the mem-update tool for modifying existing observations. */
export function createUpdateTool(
	observations: ObservationRepository,
	sessions: SessionRepository,
	projectPath: string,
): ToolDefinition {
	return {
		name: "mem-update",
		description: `Update an existing observation in memory.
Use this to correct or refine previously saved observations.
Only observations belonging to the current project can be updated.`,
		args: updateArgsSchema.shape,
		execute: async (rawArgs, _context) => {
			try {
				const args: UpdateArgs = updateArgsSchema.parse(rawArgs);

				const existing = observations.getById(args.id);
				if (!existing) {
					return `Update error: observation "${args.id}" not found in this project.`;
				}

				const session = sessions.getById(existing.sessionId);
				if (!session || session.projectPath !== projectPath) {
					return `Update error: observation "${args.id}" not found in this project.`;
				}

				const { id: _id, ...updateData } = args;
				const updated = observations.update(args.id, updateData);
				if (!updated) {
					return `Update error: observation "${args.id}" not found.`;
				}

				const changedFields = Object.keys(updateData).filter(
					(k) => updateData[k as keyof typeof updateData] !== undefined,
				);

				return `Updated observation "${updated.title}" (ID: ${updated.id}). Changed: ${changedFields.join(", ") || "nothing"}.`;
			} catch (error) {
				return `Update error: ${error}`;
			}
		},
	};
}
