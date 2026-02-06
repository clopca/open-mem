// =============================================================================
// open-mem — Context Injection Hook (experimental.chat.system.transform)
// =============================================================================

import { buildContextString } from "../context/builder";
import { buildProgressiveContext } from "../context/progressive";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { OpenMemConfig } from "../types";

/**
 * Factory for the `experimental.chat.system.transform` hook.
 *
 * Appends relevant past-session context (summaries + observation index)
 * to the system prompt within the configured token budget.
 *
 * The handler NEVER throws.
 */
export function createContextInjectionHook(
	config: OpenMemConfig,
	observations: ObservationRepository,
	sessions: SessionRepository,
	summaries: SummaryRepository,
	projectPath: string,
) {
	return async (
		_input: { sessionID?: string; model: string },
		output: { system: string[] },
	): Promise<void> => {
		try {
			if (!config.contextInjectionEnabled) return;

			const recentSessions = sessions.getRecent(projectPath, 5);
			if (recentSessions.length === 0) return;

			const recentSummaries = recentSessions
				.map((s) => (s.summaryId ? summaries.getBySessionId(s.id) : null))
				.filter((s): s is NonNullable<typeof s> => s !== null);

			const observationIndex = observations.getIndex(projectPath, config.maxIndexEntries);

			if (recentSummaries.length === 0 && observationIndex.length === 0) {
				return;
			}

			const progressive = buildProgressiveContext(
				recentSessions,
				recentSummaries,
				observationIndex,
				config.maxContextTokens,
			);

			output.system.push(buildContextString(progressive));
		} catch (error) {
			console.error("[open-mem] Context injection error:", error);
		}
	};
}
