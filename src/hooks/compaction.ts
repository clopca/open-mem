// =============================================================================
// open-mem — Compaction Hook (experimental.session.compacting)
// =============================================================================

import { estimateTokens } from "../ai/parser";
import { buildCompactContext, buildUserCompactContext } from "../context/builder";
import { buildProgressiveContext } from "../context/progressive";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { UserObservationRepository } from "../db/user-memory";
import type { Observation, OpenMemConfig } from "../types";

// -----------------------------------------------------------------------------
// Decision Section Builder
// -----------------------------------------------------------------------------

const TYPE_ICONS: Record<string, string> = {
	bugfix: "🔴",
	feature: "🟣",
	refactor: "🔄",
	change: "✅",
	discovery: "🔵",
	decision: "⚖️",
};

/** Build a plain-text section highlighting key decisions from observations. */
export function buildDecisionsSection(decisions: Observation[]): string {
	if (decisions.length === 0) return "";
	const parts: string[] = [];
	parts.push("\nKey decisions:");
	for (const d of decisions) {
		parts.push(`- ${TYPE_ICONS[d.type] || "📝"} ${d.title}: ${d.narrative}`);
	}
	return parts.join("\n");
}

/** Build a plain-text section with compressed full observation details. */
export function buildFullObservationsSection(observations: Observation[]): string {
	if (observations.length === 0) return "";
	const parts: string[] = [];
	parts.push("\nRecent observation details:");
	for (const obs of observations) {
		const icon = TYPE_ICONS[obs.type] || "📝";
		parts.push(`- ${icon} ${obs.title}: ${obs.narrative}`);
		if (obs.facts.length > 0) {
			parts.push(`  Facts: ${obs.facts.join("; ")}`);
		}
	}
	return parts.join("\n");
}

/** Create the session compaction hook that injects memory context during compaction. */
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

			const totalBudget = Math.floor(config.maxContextTokens / 2);

			const recentSessions = sessions.getRecent(projectPath, 3);
			const recentSummaries = recentSessions
				.map((s) => (s.summaryId ? summaries.getBySessionId(s.id) : null))
				.filter((s): s is NonNullable<typeof s> => s !== null);

			const observationIndex = observations.getIndex(projectPath, 20);

			let fullObservations: import("../types").Observation[] = [];
			try {
				fullObservations = observations.listByProject(projectPath, {
					limit: 5,
					state: "current",
				});
			} catch {
				// graceful degradation if listByProject unavailable
			}

			if (
				recentSummaries.length === 0 &&
				observationIndex.length === 0 &&
				fullObservations.length === 0
			) {
				return;
			}

			// Budget allocation: 40% summaries+index, 40% full observations, 20% decisions
			const indexBudget = Math.floor(totalBudget * 0.4);

			const progressive = buildProgressiveContext(
				recentSessions,
				recentSummaries,
				observationIndex,
				indexBudget,
				fullObservations,
			);

			let contextStr = buildCompactContext(progressive);

			// Append full observation details within budget
			const observationDetailsBudget = Math.floor(totalBudget * 0.4);
			const detailsSection = buildFullObservationsSection(fullObservations);
			if (detailsSection && estimateTokens(detailsSection) <= observationDetailsBudget) {
				contextStr += detailsSection;
			} else if (detailsSection) {
				// Truncate to fit within budget — include as many observations as fit
				const truncated: Observation[] = [];
				let used = 0;
				for (const obs of fullObservations) {
					const entry = `- ${TYPE_ICONS[obs.type] || "📝"} ${obs.title}: ${obs.narrative}`;
					const tokens = estimateTokens(entry);
					if (used + tokens > observationDetailsBudget) break;
					truncated.push(obs);
					used += tokens;
				}
				if (truncated.length > 0) {
					contextStr += buildFullObservationsSection(truncated);
				}
			}

			// Append key decisions with priority
			const decisionsBudget = Math.floor(totalBudget * 0.2);
			const decisions = fullObservations.filter((o) => o.type === "decision");
			if (decisions.length > 0) {
				const decisionsSection = buildDecisionsSection(decisions);
				if (estimateTokens(decisionsSection) <= decisionsBudget) {
					contextStr += decisionsSection;
				}
			}

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
