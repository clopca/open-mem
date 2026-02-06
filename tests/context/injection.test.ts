// =============================================================================
// open-mem — Context Injection Tests (Task 15)
// =============================================================================

import { describe, test, expect } from "bun:test";
import {
	buildProgressiveContext,
	type ProgressiveContext,
} from "../../src/context/progressive";
import {
	buildContextString,
	buildCompactContext,
} from "../../src/context/builder";
import { createContextInjectionHook } from "../../src/hooks/context-inject";
import { createCompactionHook } from "../../src/hooks/compaction";
import type {
	ObservationIndex,
	OpenMemConfig,
	Session,
	SessionSummary,
} from "../../src/types";
import { getDefaultConfig } from "../../src/config";

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

function makeIndexEntry(
	overrides?: Partial<ObservationIndex>,
): ObservationIndex {
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
	test("produces valid XML structure", () => {
		const context: ProgressiveContext = {
			recentSummaries: [makeSummary()],
			observationIndex: [makeIndexEntry()],
			totalTokens: 25,
		};
		const xml = buildContextString(context);
		expect(xml).toContain("<open_mem_context>");
		expect(xml).toContain("</open_mem_context>");
		expect(xml).toContain("<recent_sessions>");
		expect(xml).toContain("<observation_index");
	});

	test("includes mem-search hint", () => {
		const context: ProgressiveContext = {
			recentSummaries: [],
			observationIndex: [makeIndexEntry()],
			totalTokens: 5,
		};
		const xml = buildContextString(context);
		expect(xml).toContain("mem-search");
	});

	test("omits empty sections", () => {
		const context: ProgressiveContext = {
			recentSummaries: [],
			observationIndex: [],
			totalTokens: 0,
		};
		const xml = buildContextString(context);
		expect(xml).not.toContain("<recent_sessions>");
		expect(xml).not.toContain("<observation_index");
	});
});

describe("buildCompactContext", () => {
	test("produces plain text", () => {
		const context: ProgressiveContext = {
			recentSummaries: [makeSummary()],
			observationIndex: [makeIndexEntry()],
			totalTokens: 25,
		};
		const text = buildCompactContext(context);
		expect(text).toContain("[open-mem] Memory context:");
		expect(text).toContain("Recent sessions:");
		expect(text).toContain("- Explored JWT");
		expect(text).toContain("[discovery] Found auth pattern");
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
			},
			sessions: {
				getRecent: () => data?.sessions ?? [],
			},
			summaries: {
				getBySessionId: (id: string) =>
					data?.summaries?.find((s) => s.sessionId === id) ?? null,
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
		expect(output.system[1]).toContain("<open_mem_context>");
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
