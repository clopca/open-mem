// =============================================================================
// open-mem — Progressive Disclosure Logic
// =============================================================================

import { estimateTokens } from "../ai/parser";
import type { Observation, ObservationIndex, Session, SessionSummary } from "../types";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ProgressiveContext {
	recentSummaries: SessionSummary[];
	observationIndex: ObservationIndex[];
	fullObservations: Observation[];
	totalTokens: number;
}

// -----------------------------------------------------------------------------
// Builder
// -----------------------------------------------------------------------------

/**
 * Select summaries and observation-index entries that fit within the
 * token budget. Summaries are higher priority (richer context).
 */
export function buildProgressiveContext(
	_recentSessions: ReadonlyArray<Session>,
	summaries: ReadonlyArray<SessionSummary>,
	observationIndex: ReadonlyArray<ObservationIndex>,
	maxTokens: number,
	fullObservations: ReadonlyArray<Observation> = [],
): ProgressiveContext {
	let budget = maxTokens;
	const includedSummaries: SessionSummary[] = [];
	const includedIndex: ObservationIndex[] = [];

	// Priority 1 — session summaries (most valuable)
	for (const summary of summaries) {
		const tokens = summary.tokenCount || estimateTokens(summary.summary);
		if (budget - tokens < 0) break;
		includedSummaries.push(summary);
		budget -= tokens;
	}

	// Priority 2 — lightweight observation index entries
	for (const entry of observationIndex) {
		const tokens = entry.tokenCount || estimateTokens(entry.title);
		if (budget - tokens < 0) break;
		includedIndex.push(entry);
		budget -= tokens;
	}

	return {
		recentSummaries: includedSummaries,
		observationIndex: includedIndex,
		fullObservations: [...fullObservations],
		totalTokens: maxTokens - budget,
	};
}
