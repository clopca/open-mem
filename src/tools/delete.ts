import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { ToolDefinition } from "../types";

const deleteArgsSchema = z.object({
	id: z.string().describe("Observation ID to delete"),
});

type DeleteArgs = z.infer<typeof deleteArgsSchema>;

/** Create the mem-delete tool for removing observations from memory. */
export function createDeleteTool(
	observations: ObservationRepository,
	sessions: SessionRepository,
	projectPath: string,
): ToolDefinition {
	return {
		description: `Delete an observation from memory.
Use this to remove incorrect, outdated, or duplicate observations.
Only observations belonging to the current project can be deleted.`,
		args: deleteArgsSchema.shape,
		execute: async (rawArgs, _context) => {
			try {
				const args: DeleteArgs = deleteArgsSchema.parse(rawArgs);

				const existing = observations.getById(args.id);
				if (!existing) {
					return `Delete error: observation "${args.id}" not found in this project.`;
				}

				const session = sessions.getById(existing.sessionId);
				if (!session || session.projectPath !== projectPath) {
					return `Delete error: observation "${args.id}" not found in this project.`;
				}

				const title = existing.title;
				const deleted = observations.delete(args.id);
				if (!deleted) {
					return `Delete error: failed to delete observation "${args.id}".`;
				}

				return `Deleted observation: [${existing.type}] "${title}" (ID: ${args.id})`;
			} catch (error) {
				return `Delete error: ${error}`;
			}
		},
	};
}
