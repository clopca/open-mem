// =============================================================================
// open-mem — mem-import Custom Tool
// =============================================================================

import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { Observation, SessionSummary, ToolDefinition } from "../types";

interface ExportData {
	version: number;
	exportedAt: string;
	project: string;
	observations: Array<Omit<Observation, "rawToolOutput"> & { rawToolOutput?: string }>;
	summaries: SessionSummary[];
}

const importArgsSchema = z.object({
	data: z.string().describe("JSON string from a mem-export output"),
});

type ImportArgs = z.infer<typeof importArgsSchema>;

export function createImportTool(
	observations: ObservationRepository,
	summaries: SummaryRepository,
	sessions: SessionRepository,
	projectPath: string,
): ToolDefinition {
	return {
		name: "mem-import",
		description: `Import observations and session summaries from a JSON export.
Use this to restore memories from a backup, or import memories from another machine.
Skips duplicate observations (by ID) and summaries (by session ID).`,
		args: importArgsSchema.shape,
		execute: async (rawArgs) => {
			try {
				const args: ImportArgs = importArgsSchema.parse(rawArgs);

				let parsed: ExportData;
				try {
					parsed = JSON.parse(args.data);
				} catch {
					return "Import error: Invalid JSON. Please provide valid JSON from a mem-export.";
				}

				if (!parsed.version || typeof parsed.version !== "number") {
					return "Import error: Missing or invalid 'version' field. This doesn't look like a mem-export file.";
				}

				if (parsed.version !== 1) {
					return `Import error: Unsupported export version ${parsed.version}. This tool supports version 1.`;
				}

				if (!Array.isArray(parsed.observations)) {
					return "Import error: Missing or invalid 'observations' array.";
				}

				let imported = 0;
				let skipped = 0;
				let summariesImported = 0;
				let summariesSkipped = 0;

				for (const obs of parsed.observations) {
					const existing = observations.getById(obs.id);
					if (existing) {
						skipped++;
						continue;
					}

					sessions.getOrCreate(obs.sessionId, projectPath);

					observations.importObservation({
						id: obs.id,
						sessionId: obs.sessionId,
						type: obs.type,
						title: obs.title,
						subtitle: obs.subtitle ?? "",
						facts: obs.facts ?? [],
						narrative: obs.narrative ?? "",
						concepts: obs.concepts ?? [],
						filesRead: obs.filesRead ?? [],
						filesModified: obs.filesModified ?? [],
						rawToolOutput: obs.rawToolOutput ?? "",
						toolName: obs.toolName ?? "unknown",
						createdAt: obs.createdAt,
						tokenCount: obs.tokenCount ?? 0,
						discoveryTokens: obs.discoveryTokens ?? 0,
					});

					sessions.incrementObservationCount(obs.sessionId);
					imported++;
				}

				if (Array.isArray(parsed.summaries)) {
					for (const summary of parsed.summaries) {
						const existing = summaries.getBySessionId(summary.sessionId);
						if (existing) {
							summariesSkipped++;
							continue;
						}

						sessions.getOrCreate(summary.sessionId, projectPath);

						summaries.importSummary({
							id: summary.id,
							sessionId: summary.sessionId,
							summary: summary.summary ?? "",
							keyDecisions: summary.keyDecisions ?? [],
							filesModified: summary.filesModified ?? [],
							concepts: summary.concepts ?? [],
							createdAt: summary.createdAt,
							tokenCount: summary.tokenCount ?? 0,
							request: summary.request,
							investigated: summary.investigated,
							learned: summary.learned,
							completed: summary.completed,
							nextSteps: summary.nextSteps,
						});

						sessions.setSummary(summary.sessionId, summary.id);
						summariesImported++;
					}
				}

				const parts: string[] = [];
				parts.push(`Imported ${imported} observation(s)`);
				parts.push(`${summariesImported} summary(ies)`);
				if (skipped > 0) parts.push(`Skipped ${skipped} duplicate observation(s)`);
				if (summariesSkipped > 0) parts.push(`skipped ${summariesSkipped} duplicate summary(ies)`);

				return `${parts.join(". ")}.`;
			} catch (error) {
				return `Import error: ${error}`;
			}
		},
	};
}
