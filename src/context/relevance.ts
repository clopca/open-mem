// =============================================================================
// open-mem — Relevance Scoring for Session-Scoped Memory Pruning
// =============================================================================
//
// Scores observations by relevance to prioritize recent, important entries
// and prune less relevant ones during long coding sessions.
// =============================================================================

import type { ObservationIndex, ObservationType } from "../types";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface ScoringContext {
	/** Boost observations from the current session */
	currentSessionId?: string;
	/** Reference time for recency scoring */
	now: Date;
	/** Files recently touched — boost matching observations */
	recentFileContext?: string[];
}

// -----------------------------------------------------------------------------
// Scoring Weights
// -----------------------------------------------------------------------------

const WEIGHTS = {
	recency: 0.4,
	typeImportance: 0.3,
	sessionAffinity: 0.2,
	tokenEfficiency: 0.1,
} as const;

// -----------------------------------------------------------------------------
// Type Importance Scores
// -----------------------------------------------------------------------------

const TYPE_IMPORTANCE: Record<ObservationType, number> = {
	decision: 1.0,
	bugfix: 0.9,
	feature: 0.8,
	refactor: 0.6,
	discovery: 0.5,
	change: 0.4,
};

/** Default importance for unknown/unrecognized types */
const DEFAULT_TYPE_IMPORTANCE = 0.3;

// -----------------------------------------------------------------------------
// Token Efficiency Constants
// -----------------------------------------------------------------------------

/** Observations at or below this token count get max efficiency score */
const MIN_EFFICIENT_TOKENS = 10;

/** Observations at or above this token count get min efficiency score */
const MAX_EFFICIENT_TOKENS = 200;

// -----------------------------------------------------------------------------
// Recency Scoring
// -----------------------------------------------------------------------------

/**
 * Compute recency score using exponential decay.
 *
 * - Today (< 24h): 1.0
 * - Yesterday (24-48h): 0.8
 * - Last week (2-7 days): 0.5
 * - Older (> 7 days): 0.2
 */
export function scoreRecency(createdAt: string, now: Date): number {
	const created = new Date(createdAt);
	const diffMs = now.getTime() - created.getTime();
	const diffHours = diffMs / (1000 * 60 * 60);

	if (diffHours < 0) return 1.0; // Future dates treated as most recent
	if (diffHours < 24) return 1.0;
	if (diffHours < 48) return 0.8;
	if (diffHours < 168) return 0.5; // 7 * 24 = 168 hours
	return 0.2;
}

// -----------------------------------------------------------------------------
// Type Importance Scoring
// -----------------------------------------------------------------------------

/**
 * Score based on observation type importance.
 * Decisions and bugfixes are most valuable; changes are least.
 */
export function scoreTypeImportance(type: ObservationType): number {
	return TYPE_IMPORTANCE[type] ?? DEFAULT_TYPE_IMPORTANCE;
}

// -----------------------------------------------------------------------------
// Session Affinity Scoring
// -----------------------------------------------------------------------------

/**
 * Boost observations from the current session.
 * Current session = 1.0, other sessions = 0.3.
 */
export function scoreSessionAffinity(
	entrySessionId: string,
	currentSessionId: string | undefined,
): number {
	if (!currentSessionId) return 0.5; // Neutral when no session context
	return entrySessionId === currentSessionId ? 1.0 : 0.3;
}

// -----------------------------------------------------------------------------
// Token Efficiency Scoring
// -----------------------------------------------------------------------------

/**
 * Smaller observations score higher — they give more info per token.
 * Linear interpolation between MIN_EFFICIENT_TOKENS (score=1.0)
 * and MAX_EFFICIENT_TOKENS (score=0.2).
 */
export function scoreTokenEfficiency(tokenCount: number): number {
	if (tokenCount <= MIN_EFFICIENT_TOKENS) return 1.0;
	if (tokenCount >= MAX_EFFICIENT_TOKENS) return 0.2;

	// Linear interpolation
	const ratio = (tokenCount - MIN_EFFICIENT_TOKENS) / (MAX_EFFICIENT_TOKENS - MIN_EFFICIENT_TOKENS);
	return 1.0 - ratio * 0.8; // Maps [0, 1] → [1.0, 0.2]
}

// -----------------------------------------------------------------------------
// Combined Scoring
// -----------------------------------------------------------------------------

/**
 * Compute a weighted relevance score for an observation index entry.
 *
 * Score = recency * 0.4 + typeImportance * 0.3 + sessionAffinity * 0.2 + tokenEfficiency * 0.1
 *
 * Returns a value in [0, 1] where higher = more relevant.
 */
export function scoreObservation(entry: ObservationIndex, context: ScoringContext): number {
	const recency = scoreRecency(entry.createdAt, context.now);
	const typeImp = scoreTypeImportance(entry.type);
	const session = scoreSessionAffinity(entry.sessionId, context.currentSessionId);
	const efficiency = scoreTokenEfficiency(entry.tokenCount);

	return (
		recency * WEIGHTS.recency +
		typeImp * WEIGHTS.typeImportance +
		session * WEIGHTS.sessionAffinity +
		efficiency * WEIGHTS.tokenEfficiency
	);
}

// -----------------------------------------------------------------------------
// Sorting Helper
// -----------------------------------------------------------------------------

/**
 * Sort observation index entries by relevance score (descending).
 * Returns a new array — does not mutate the input.
 */
export function sortByRelevance(
	entries: ReadonlyArray<ObservationIndex>,
	context: ScoringContext,
): ObservationIndex[] {
	return [...entries].sort((a, b) => {
		const scoreA = scoreObservation(a, context);
		const scoreB = scoreObservation(b, context);
		// Descending — higher score first
		if (scoreB !== scoreA) return scoreB - scoreA;
		// Tie-break: more recent first
		return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
	});
}
