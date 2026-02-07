// =============================================================================
// open-mem — Relevance Scoring Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { buildProgressiveContext } from "../../src/context/progressive";
import {
	type ScoringContext,
	scoreObservation,
	scoreRecency,
	scoreSessionAffinity,
	scoreTokenEfficiency,
	scoreTypeImportance,
	sortByRelevance,
} from "../../src/context/relevance";
import type { ObservationIndex, ObservationType, SessionSummary } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<ObservationIndex>): ObservationIndex {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		tokenCount: 15,
		discoveryTokens: 100,
		createdAt: "2026-01-15T12:00:00Z",
		importance: 3,
		...overrides,
	};
}

function hoursAgo(hours: number, from: Date = new Date("2026-01-15T12:00:00Z")): string {
	return new Date(from.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
	return {
		id: "sum-1",
		sessionId: "sess-1",
		summary: "Session summary text",
		keyDecisions: [],
		filesModified: [],
		concepts: [],
		createdAt: "2026-01-15T12:00:00Z",
		tokenCount: 20,
		...overrides,
	};
}

// =============================================================================
// Recency Scoring
// =============================================================================

describe("scoreRecency", () => {
	const now = new Date("2026-01-15T12:00:00Z");

	test("today (< 24h) scores 1.0", () => {
		expect(scoreRecency(hoursAgo(1, now), now)).toBe(1.0);
		expect(scoreRecency(hoursAgo(23, now), now)).toBe(1.0);
	});

	test("yesterday (24-48h) scores 0.8", () => {
		expect(scoreRecency(hoursAgo(25, now), now)).toBe(0.8);
		expect(scoreRecency(hoursAgo(47, now), now)).toBe(0.8);
	});

	test("last week (2-7 days) scores 0.5", () => {
		expect(scoreRecency(hoursAgo(49, now), now)).toBe(0.5);
		expect(scoreRecency(hoursAgo(167, now), now)).toBe(0.5);
	});

	test("older than a week scores 0.2", () => {
		expect(scoreRecency(hoursAgo(169, now), now)).toBe(0.2);
		expect(scoreRecency(hoursAgo(720, now), now)).toBe(0.2);
	});

	test("future dates score 1.0", () => {
		const futureDate = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
		expect(scoreRecency(futureDate, now)).toBe(1.0);
	});

	test("exact boundary at 24h scores 0.8 (falls into yesterday bucket)", () => {
		expect(scoreRecency(hoursAgo(24, now), now)).toBe(0.8);
	});
});

// =============================================================================
// Type Importance Scoring
// =============================================================================

describe("scoreTypeImportance", () => {
	test("decision is highest priority", () => {
		expect(scoreTypeImportance("decision")).toBe(1.0);
	});

	test("bugfix is high priority", () => {
		expect(scoreTypeImportance("bugfix")).toBe(0.9);
	});

	test("change is lowest priority", () => {
		expect(scoreTypeImportance("change")).toBe(0.4);
	});

	test("all types have defined scores", () => {
		const types: ObservationType[] = [
			"decision",
			"bugfix",
			"feature",
			"refactor",
			"discovery",
			"change",
		];
		for (const type of types) {
			const score = scoreTypeImportance(type);
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		}
	});

	test("types are ordered by importance", () => {
		expect(scoreTypeImportance("decision")).toBeGreaterThan(scoreTypeImportance("bugfix"));
		expect(scoreTypeImportance("bugfix")).toBeGreaterThan(scoreTypeImportance("feature"));
		expect(scoreTypeImportance("feature")).toBeGreaterThan(scoreTypeImportance("refactor"));
		expect(scoreTypeImportance("refactor")).toBeGreaterThan(scoreTypeImportance("discovery"));
		expect(scoreTypeImportance("discovery")).toBeGreaterThan(scoreTypeImportance("change"));
	});
});

// =============================================================================
// Session Affinity Scoring
// =============================================================================

describe("scoreSessionAffinity", () => {
	test("current session scores 1.0", () => {
		expect(scoreSessionAffinity("sess-1", "sess-1")).toBe(1.0);
	});

	test("different session scores 0.3", () => {
		expect(scoreSessionAffinity("sess-1", "sess-2")).toBe(0.3);
	});

	test("no current session returns neutral 0.5", () => {
		expect(scoreSessionAffinity("sess-1", undefined)).toBe(0.5);
	});
});

// =============================================================================
// Token Efficiency Scoring
// =============================================================================

describe("scoreTokenEfficiency", () => {
	test("small observations (≤10 tokens) score 1.0", () => {
		expect(scoreTokenEfficiency(5)).toBe(1.0);
		expect(scoreTokenEfficiency(10)).toBe(1.0);
	});

	test("large observations (≥200 tokens) score 0.2", () => {
		expect(scoreTokenEfficiency(200)).toBe(0.2);
		expect(scoreTokenEfficiency(500)).toBe(0.2);
	});

	test("mid-range observations interpolate linearly", () => {
		const midScore = scoreTokenEfficiency(105);
		expect(midScore).toBeGreaterThan(0.2);
		expect(midScore).toBeLessThan(1.0);
		expect(midScore).toBeCloseTo(0.6, 1);
	});

	test("zero tokens scores 1.0", () => {
		expect(scoreTokenEfficiency(0)).toBe(1.0);
	});
});

// =============================================================================
// Combined Scoring
// =============================================================================

describe("scoreObservation", () => {
	const now = new Date("2026-01-15T12:00:00Z");

	test("recent decision from current session scores highest", () => {
		const entry = makeEntry({
			type: "decision",
			createdAt: hoursAgo(1, now),
			sessionId: "current",
			tokenCount: 5,
		});
		const ctx: ScoringContext = { now, currentSessionId: "current" };
		const score = scoreObservation(entry, ctx);
		expect(score).toBeGreaterThan(0.9);
	});

	test("old change from different session scores lowest", () => {
		const entry = makeEntry({
			type: "change",
			createdAt: hoursAgo(200, now),
			sessionId: "old-sess",
			tokenCount: 300,
		});
		const ctx: ScoringContext = { now, currentSessionId: "current" };
		const score = scoreObservation(entry, ctx);
		expect(score).toBeLessThan(0.35);
	});

	test("score is between 0 and 1", () => {
		const entry = makeEntry();
		const ctx: ScoringContext = { now };
		const score = scoreObservation(entry, ctx);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});

	test("same timestamps produce deterministic scores", () => {
		const entry1 = makeEntry({ id: "a", type: "feature", createdAt: hoursAgo(5, now) });
		const entry2 = makeEntry({ id: "b", type: "feature", createdAt: hoursAgo(5, now) });
		const ctx: ScoringContext = { now };
		expect(scoreObservation(entry1, ctx)).toBe(scoreObservation(entry2, ctx));
	});
});

// =============================================================================
// Sorting
// =============================================================================

describe("sortByRelevance", () => {
	const now = new Date("2026-01-15T12:00:00Z");

	test("sorts by score descending", () => {
		const entries = [
			makeEntry({ id: "old-change", type: "change", createdAt: hoursAgo(200, now) }),
			makeEntry({ id: "recent-decision", type: "decision", createdAt: hoursAgo(1, now) }),
			makeEntry({ id: "mid-feature", type: "feature", createdAt: hoursAgo(30, now) }),
		];
		const ctx: ScoringContext = { now };
		const sorted = sortByRelevance(entries, ctx);
		expect(sorted[0].id).toBe("recent-decision");
		expect(sorted[sorted.length - 1].id).toBe("old-change");
	});

	test("does not mutate input array", () => {
		const entries = [
			makeEntry({ id: "b", type: "change", createdAt: hoursAgo(200, now) }),
			makeEntry({ id: "a", type: "decision", createdAt: hoursAgo(1, now) }),
		];
		const ctx: ScoringContext = { now };
		const sorted = sortByRelevance(entries, ctx);
		expect(entries[0].id).toBe("b");
		expect(sorted[0].id).toBe("a");
	});

	test("tie-breaks by recency (more recent first)", () => {
		const entries = [
			makeEntry({ id: "older", type: "discovery", tokenCount: 15, createdAt: hoursAgo(5, now) }),
			makeEntry({ id: "newer", type: "discovery", tokenCount: 15, createdAt: hoursAgo(2, now) }),
		];
		const ctx: ScoringContext = { now };
		const sorted = sortByRelevance(entries, ctx);
		expect(sorted[0].id).toBe("newer");
		expect(sorted[1].id).toBe("older");
	});
});

// =============================================================================
// Progressive Context Integration
// =============================================================================

describe("buildProgressiveContext with scoringContext", () => {
	const now = new Date("2026-01-15T12:00:00Z");

	test("without scoringContext preserves chronological order", () => {
		const index = [
			makeEntry({ id: "first", type: "change", tokenCount: 10, createdAt: hoursAgo(200, now) }),
			makeEntry({ id: "second", type: "decision", tokenCount: 10, createdAt: hoursAgo(1, now) }),
		];
		const result = buildProgressiveContext([], [], index, 100);
		expect(result.observationIndex[0].id).toBe("first");
		expect(result.observationIndex[1].id).toBe("second");
	});

	test("with scoringContext sorts by relevance before budget", () => {
		const index = [
			makeEntry({
				id: "old-change",
				type: "change",
				tokenCount: 10,
				createdAt: hoursAgo(200, now),
			}),
			makeEntry({
				id: "recent-decision",
				type: "decision",
				tokenCount: 10,
				createdAt: hoursAgo(1, now),
			}),
		];
		const ctx: ScoringContext = { now };
		const result = buildProgressiveContext([], [], index, 100, [], ctx);
		expect(result.observationIndex[0].id).toBe("recent-decision");
		expect(result.observationIndex[1].id).toBe("old-change");
	});

	test("relevance sorting affects which entries fit in budget", () => {
		const index = [
			makeEntry({
				id: "low-relevance",
				type: "change",
				tokenCount: 15,
				createdAt: hoursAgo(200, now),
			}),
			makeEntry({
				id: "high-relevance",
				type: "decision",
				tokenCount: 15,
				createdAt: hoursAgo(1, now),
			}),
		];
		const ctx: ScoringContext = { now };
		const result = buildProgressiveContext([], [], index, 15, [], ctx);
		expect(result.observationIndex).toHaveLength(1);
		expect(result.observationIndex[0].id).toBe("high-relevance");
	});

	test("summaries still take priority over scored observations", () => {
		const summaries = [makeSummary({ tokenCount: 40 })];
		const index = [
			makeEntry({ id: "obs", type: "decision", tokenCount: 20, createdAt: hoursAgo(1, now) }),
		];
		const ctx: ScoringContext = { now };
		const result = buildProgressiveContext([], summaries, index, 50, [], ctx);
		expect(result.recentSummaries).toHaveLength(1);
		expect(result.observationIndex).toHaveLength(0);
	});
});
