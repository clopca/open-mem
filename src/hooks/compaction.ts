// =============================================================================
// open-mem — Compaction Hook (experimental.session.compacting)
// =============================================================================

import { buildCompactContext, buildUserCompactContext } from "../context/builder";
import { buildProgressiveContext } from "../context/progressive";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { UserObservationRepository } from "../db/user-memory";
import type { OpenMemConfig } from "../types";

export function createCompactionHook(
	config: OpenMemConfig,
	observations: ObservationRepository,
	sessions: SessionRepository,
	summaries: SummaryRepository,
	projectPath: string,
	userObservationRepo?: UserObservationRepository | null,
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

			let contextStr = buildCompactContext(progressive);

			if (config.userMemoryEnabled && userObservationRepo) {
				const userIndex = userObservationRepo.getIndex(10);
				const userSection = buildUserCompactContext(
					userIndex,
					Math.floor(config.userMemoryMaxContextTokens / 2),
				);
				if (userSection) {
					contextStr += userSection;
				}
			}

			output.context.push(contextStr);
		} catch (error) {
			console.error("[open-mem] Compaction hook error:", error);
		}
	};
}
