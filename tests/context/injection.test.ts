// =============================================================================
// open-mem — Context Injection Tests (Task 15)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import { buildCompactContext, buildContextString } from "../../src/context/builder";
import { type ProgressiveContext, buildProgressiveContext } from "../../src/context/progressive";
import { createCompactionHook } from "../../src/hooks/compaction";
import { createContextInjectionHook } from "../../src/hooks/context-inject";
import type { ObservationIndex, OpenMemConfig, Session, SessionSummary } from "../../src/types";

// ---------------------------------------------------------------------------
// Test Data
// ---------------------------------------------------------------------------

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
	return {
		id: "sum-1",
		sessionId: "sess-1",
		summary: "Explored JWT auth patterns in the codebase.",
		keyDecisions: ["Use RS256"],
		filesModified: ["src/auth.ts"],
		concepts: ["JWT", "authentication"],
		createdAt: "2026-01-01T00:00:00Z",
		tokenCount: 20,
		...overrides,
	};
}

function makeIndexEntry(overrides?: Partial<ObservationIndex>): ObservationIndex {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		tokenCount: 5,
		createdAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

function makeSession(overrides?: Partial<Session>): Session {
	return {
		id: "sess-1",
		projectPath: "/tmp/proj",
		startedAt: "2026-01-01T00:00:00Z",
		endedAt: null,
		status: "active",
		observationCount: 3,
		summaryId: "sum-1",
		...overrides,
	};
}

// =============================================================================
// Progressive Disclosure
// =============================================================================

describe("buildProgressiveContext", () => {
	test("respects token budget", () => {
		const summaries = [makeSummary({ tokenCount: 60 })];
		const index = [
			makeIndexEntry({ tokenCount: 30 }),
			makeIndexEntry({ id: "obs-2", tokenCount: 30 }),
		];
		const result = buildProgressiveContext([], summaries, index, 80);
		// Budget=80: summary(60) + first index(30) = 90 > 80
		// So only summary + first index that fits
		expect(result.recentSummaries).toHaveLength(1);
		expect(result.observationIndex).toHaveLength(0); // 60+30 > 80
		expect(result.totalTokens).toBe(60);
	});

	test("prioritizes summaries over index entries", () => {
		const summaries = [
			makeSummary({ tokenCount: 40 }),
			makeSummary({ id: "sum-2", sessionId: "sess-2", tokenCount: 40 }),
		];
		const index = [makeIndexEntry({ tokenCount: 10 })];
		const result = buildProgressiveContext([], summaries, index, 50);
		// Budget=50: first summary(40) fits, second(40) doesn't
		expect(result.recentSummaries).toHaveLength(1);
		expect(result.observationIndex).toHaveLength(1); // 40+10 = 50
	});
});

// =============================================================================
// Context Builder
// =============================================================================

describe("buildContextString", () => {
	test("produces Markdown with progressive disclosure header", () => {
		const context: ProgressiveContext = {
			recentSummaries: [makeSummary()],
			observationIndex: [makeIndexEntry()],
			fullObservations: [],
			totalTokens: 25,
		};
		const output = buildContextString(context);
		expect(output).toContain("## open-mem");
		expect(output).toContain("Progressive Disclosure");
		expect(output).toContain("mem-search");
		expect(output).toContain("mem-recall");
	});

	test("includes mem-search and mem-recall hints", () => {
		const context: ProgressiveContext = {
			recentSummaries: [],
			observationIndex: [makeIndexEntry()],
			fullObservations: [],
			totalTokens: 5,
		};
		const output = buildContextString(context);
		expect(output).toContain("mem-search");
		expect(output).toContain("mem-recall");
	});

	test("omits empty sections", () => {
		const context: ProgressiveContext = {
			recentSummaries: [],
			observationIndex: [],
			fullObservations: [],
			totalTokens: 0,
		};
		const output = buildContextString(context);
		expect(output).not.toContain("Recent Sessions");
		expect(output).not.toContain("Recent Observations");
	});
});

describe("buildCompactContext", () => {
	test("produces plain text with type icons", () => {
		const context: ProgressiveContext = {
			recentSummaries: [makeSummary()],
			observationIndex: [makeIndexEntry()],
			fullObservations: [],
			totalTokens: 25,
		};
		const text = buildCompactContext(context);
		expect(text).toContain("[open-mem] Memory context:");
		expect(text).toContain("Recent sessions:");
		expect(text).toContain("- Explored JWT");
		expect(text).toContain("🔵");
		expect(text).toContain("Found auth pattern");
	});
});

// =============================================================================
// Context Injection Hook
// =============================================================================

describe("createContextInjectionHook", () => {
	function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
		return {
			...getDefaultConfig(),
			contextInjectionEnabled: true,
			maxContextTokens: 1000,
			maxIndexEntries: 20,
			...overrides,
		};
	}

	function makeMockRepos(data?: {
		sessions?: Session[];
		summaries?: SessionSummary[];
		index?: ObservationIndex[];
	}) {
		return {
			observations: {
				getIndex: () => data?.index ?? [],
				getById: (_id: string) => null,
			},
			sessions: {
				getRecent: () => data?.sessions ?? [],
			},
			summaries: {
				getBySessionId: (id: string) => data?.summaries?.find((s) => s.sessionId === id) ?? null,
			},
		};
	}

	test("appends context to output.system", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const hook = createContextInjectionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).toContain("## open-mem");
	});

	test("skips when disabled", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
		});
		const hook = createContextInjectionHook(
			makeConfig({ contextInjectionEnabled: false }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { system: ["existing"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);
		expect(output.system).toHaveLength(1);
	});

	test("skips when no data", async () => {
		const repos = makeMockRepos({ sessions: [] });
		const hook = createContextInjectionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { system: ["existing"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);
		expect(output.system).toHaveLength(1);
	});

	test("never throws on error", async () => {
		const brokenRepos = {
			observations: {
				getIndex: () => {
					throw new Error("DB error");
				},
			},
			sessions: {
				getRecent: () => [makeSession()],
			},
			summaries: { getBySessionId: () => null },
		};
		const hook = createContextInjectionHook(
			makeConfig(),
			brokenRepos.observations as never,
			brokenRepos.sessions as never,
			brokenRepos.summaries as never,
			"/tmp/proj",
		);

		const output = { system: ["existing"] };
		// Should not throw
		await hook({ model: "claude-sonnet-4-20250514" }, output);
		expect(output.system).toHaveLength(1);
	});
});

// =============================================================================
// Compaction Hook
// =============================================================================

describe("createCompactionHook", () => {
	test("uses reduced token budget", async () => {
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			contextInjectionEnabled: true,
			maxContextTokens: 1000,
		};
		const repos = {
			observations: {
				getIndex: () => [makeIndexEntry()],
			},
			sessions: {
				getRecent: () => [makeSession()],
			},
			summaries: {
				getBySessionId: () => makeSummary(),
			},
		};
		const hook = createCompactionHook(
			config,
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		expect(output.context[0]).toContain("[open-mem] Memory context:");
	});
});
