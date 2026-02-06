// =============================================================================
// open-mem — Compaction Hook (experimental.session.compacting)
// =============================================================================

import { buildCompactContext } from "../context/builder";
import { buildProgressiveContext } from "../context/progressive";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { OpenMemConfig } from "../types";

/**
 * Factory for the `experimental.session.compacting` hook.
 *
 * Injects a reduced-budget memory context during session compaction
 * so that memory survives across compaction boundaries.
 *
 * The handler NEVER throws.
 */
export function createCompactionHook(
	config: OpenMemConfig,
	observations: ObservationRepository,
	sessions: SessionRepository,
	summaries: SummaryRepository,
	projectPath: string,
) {
	return async (
		_input: { sessionID: string },
		output: { context: string[]; prompt?: string },
	): Promise<void> => {
		try {
			if (!config.contextInjectionEnabled) return;

			const recentSessions = sessions.getRecent(projectPath, 3);
			const recentSummaries = recentSessions
				.map((s) => (s.summaryId ? summaries.getBySessionId(s.id) : null))
				.filter((s): s is NonNullable<typeof s> => s !== null);

			const observationIndex = observations.getIndex(projectPath, 10);

			if (recentSummaries.length === 0 && observationIndex.length === 0) {
				return;
			}

			const progressive = buildProgressiveContext(
				recentSessions,
				recentSummaries,
				observationIndex,
				Math.floor(config.maxContextTokens / 2), // reduced budget
			);

			output.context.push(buildCompactContext(progressive));
		} catch (error) {
			console.error("[open-mem] Compaction hook error:", error);
		}
	};
}
