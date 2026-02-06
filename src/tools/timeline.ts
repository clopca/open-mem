// =============================================================================
// open-mem — mem-timeline Custom Tool
// =============================================================================

import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { ToolDefinition } from "../types";

export function createTimelineTool(
	sessions: SessionRepository,
	summaries: SummaryRepository,
	observations: ObservationRepository,
	projectPath: string,
): ToolDefinition {
	return {
		name: "mem-timeline",
		description: `View a timeline of past coding sessions for this project.
Shows recent sessions with summaries, observation counts, and key decisions.`,
		args: {
			limit: z
				.number()
				.min(1)
				.max(20)
				.default(5)
				.describe("Number of recent sessions to show"),
			sessionId: z
				.string()
				.optional()
				.describe("Show details for a specific session ID"),
		},
		execute: async (args) => {
			try {
				const limit = (args.limit as number) || 5;
				const sessionId = args.sessionId as string | undefined;

				if (sessionId) {
					return formatSessionDetail(
						sessionId,
						sessions,
						summaries,
						observations,
					);
				}

				const recent = sessions.getRecent(projectPath, limit);
				if (recent.length === 0) {
					return "No past sessions found for this project.";
				}

				const lines: string[] = [
					`# Session Timeline (${recent.length} sessions)\n`,
				];

				for (const session of recent) {
					const summary = session.summaryId
						? summaries.getBySessionId(session.id)
						: null;

					lines.push(`## Session: ${session.id}`);
					lines.push(`- **Started**: ${session.startedAt}`);
					lines.push(`- **Status**: ${session.status}`);
					lines.push(
						`- **Observations**: ${session.observationCount}`,
					);

					if (summary) {
						lines.push(`- **Summary**: ${summary.summary}`);
						if (summary.keyDecisions.length > 0) {
							lines.push(
								`- **Key decisions**: ${summary.keyDecisions.join("; ")}`,
							);
						}
					}

					lines.push("");
				}

				return lines.join("\n");
			} catch (error) {
				return `Timeline error: ${error}`;
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Session Detail Formatter
// ---------------------------------------------------------------------------

function formatSessionDetail(
	sessionId: string,
	sessions: SessionRepository,
	summaries: SummaryRepository,
	observations: ObservationRepository,
): string {
	const session = sessions.getById(sessionId);
	if (!session) return `Session ${sessionId} not found.`;

	const summary = session.summaryId
		? summaries.getBySessionId(sessionId)
		: null;
	const obs = observations.getBySession(sessionId);

	const lines: string[] = [`# Session Detail: ${sessionId}\n`];
	lines.push(`- **Started**: ${session.startedAt}`);
	lines.push(`- **Ended**: ${session.endedAt ?? "Active"}`);
	lines.push(`- **Status**: ${session.status}`);
	lines.push(`- **Observations**: ${session.observationCount}`);

	if (summary) {
		lines.push(`\n## Summary\n${summary.summary}`);
		if (summary.keyDecisions.length > 0) {
			lines.push("\n**Key decisions:**");
			for (const d of summary.keyDecisions) lines.push(`- ${d}`);
		}
	}

	if (obs.length > 0) {
		lines.push("\n## Observations");
		for (const o of obs) {
			lines.push(`\n### [${o.type.toUpperCase()}] ${o.title}`);
			lines.push(o.narrative);
			if (o.concepts.length > 0) {
				lines.push(`*Concepts: ${o.concepts.join(", ")}*`);
			}
		}
	}

	return lines.join("\n");
}
