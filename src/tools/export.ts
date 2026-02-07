// =============================================================================
// open-mem — mem-export Custom Tool
// =============================================================================

import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { Observation, SessionSummary, ToolDefinition } from "../types";

const exportArgsSchema = z.object({
	format: z
		.enum(["json"])
		.default("json")
		.describe("Export format (currently only JSON supported)"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.optional()
		.describe("Filter by observation type"),
	limit: z.number().min(1).optional().describe("Maximum number of observations to export"),
});

type ExportArgs = z.infer<typeof exportArgsSchema>;

export function createExportTool(
	observations: ObservationRepository,
	summaries: SummaryRepository,
	sessions: SessionRepository,
	projectPath: string,
): ToolDefinition {
	return {
		name: "mem-export",
		description: `Export project memories (observations and session summaries) as portable JSON.
Use this to back up memories, transfer them between machines, or share context across environments.
Returns a JSON string — the agent can write it to a file if needed.`,
		args: exportArgsSchema.shape,
		execute: async (rawArgs) => {
			try {
				const args: ExportArgs = exportArgsSchema.parse(rawArgs);

				const projectSessions = sessions.getAll(projectPath);
				if (projectSessions.length === 0) {
					return "No sessions found for this project. Nothing to export.";
				}

				let allObservations: Observation[] = [];
				for (const session of projectSessions) {
					allObservations.push(...observations.getBySession(session.id));
				}

				if (args.type) {
					allObservations = allObservations.filter((obs) => obs.type === args.type);
				}

				allObservations.sort(
					(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
				);

				if (args.limit && args.limit < allObservations.length) {
					allObservations = allObservations.slice(0, args.limit);
				}

				const exportedObservations = allObservations.map(
					({ rawToolOutput: _raw, ...rest }) => rest,
				);

				const allSummaries: SessionSummary[] = [];
				for (const session of projectSessions) {
					const summary = summaries.getBySessionId(session.id);
					if (summary) {
						allSummaries.push(summary);
					}
				}

				const exportData = {
					version: 1,
					exportedAt: new Date().toISOString(),
					project: projectPath,
					observations: exportedObservations,
					summaries: allSummaries,
				};

				const json = JSON.stringify(exportData, null, 2);

				return `Exported ${exportedObservations.length} observation(s) and ${allSummaries.length} summary(ies).\n\n${json}`;
			} catch (error) {
				return `Export error: ${error}`;
			}
		},
	};
}
