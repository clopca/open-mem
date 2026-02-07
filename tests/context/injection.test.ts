// =============================================================================
// open-mem — Context Injection Tests (Task 15)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import {
	buildCompactContext,
	buildContextString,
	buildUserCompactContext,
	buildUserContextSection,
} from "../../src/context/builder";
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

// =============================================================================
// User-Level Context Section (buildUserContextSection)
// =============================================================================

describe("buildUserContextSection", () => {
	test("returns empty string when no entries", () => {
		expect(buildUserContextSection([], 1000)).toBe("");
	});

	test("renders Cross-Project Memory header and table", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "user-1", title: "Global preference: dark mode", tokenCount: 10 }),
			makeIndexEntry({ id: "user-2", title: "Prefers TypeScript strict mode", tokenCount: 8 }),
		];
		const result = buildUserContextSection(entries, 1000);
		expect(result).toContain("### Cross-Project Memory");
		expect(result).toContain("user-1");
		expect(result).toContain("Global preference: dark mode");
		expect(result).toContain("user-2");
		expect(result).toContain("~10");
		expect(result).toContain("~8");
	});

	test("respects token budget", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "u1", title: "First", tokenCount: 8 }),
			makeIndexEntry({ id: "u2", title: "Second", tokenCount: 8 }),
			makeIndexEntry({ id: "u3", title: "Third", tokenCount: 8 }),
		];
		const result = buildUserContextSection(entries, 15);
		expect(result).toContain("u1");
		expect(result).not.toContain("u2");
		expect(result).not.toContain("u3");
	});

	test("returns empty string when budget is zero", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "u1", title: "First", tokenCount: 10 }),
		];
		expect(buildUserContextSection(entries, 0)).toBe("");
	});
});

// =============================================================================
// User-Level Compact Context (buildUserCompactContext)
// =============================================================================

describe("buildUserCompactContext", () => {
	test("returns empty string when no entries", () => {
		expect(buildUserCompactContext([], 1000)).toBe("");
	});

	test("renders cross-project observations in plain text", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "u1", title: "User prefers tabs", tokenCount: 5 }),
		];
		const result = buildUserCompactContext(entries, 1000);
		expect(result).toContain("Cross-project observations");
		expect(result).toContain("User prefers tabs");
		expect(result).toContain("🔵");
	});

	test("respects token budget", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "u1", title: "First", tokenCount: 10 }),
			makeIndexEntry({ id: "u2", title: "Second", tokenCount: 10 }),
		];
		const result = buildUserCompactContext(entries, 15);
		expect(result).toContain("First");
		expect(result).not.toContain("Second");
	});
});

// =============================================================================
// Context Injection Hook — User-Level Memory
// =============================================================================

describe("createContextInjectionHook — user-level memory", () => {
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

	test("includes Cross-Project Memory section when user memory enabled", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "user-obs-1", title: "User prefers dark mode", tokenCount: 10 }),
			],
		};
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: true, userMemoryMaxContextTokens: 500 }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).toContain("### Cross-Project Memory");
		expect(output.system[1]).toContain("User prefers dark mode");
	});

	test("omits Cross-Project Memory when userMemoryEnabled is false", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "user-obs-1", title: "Should not appear", tokenCount: 10 }),
			],
		};
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: false }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).not.toContain("Cross-Project Memory");
		expect(output.system[1]).not.toContain("Should not appear");
	});

	test("omits Cross-Project Memory when no userObservationRepo provided", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: true }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			null,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).not.toContain("Cross-Project Memory");
	});

	test("omits Cross-Project Memory when user index is empty", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const userRepo = { getIndex: () => [] };
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: true, userMemoryMaxContextTokens: 500 }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "claude-sonnet-4-20250514" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).not.toContain("Cross-Project Memory");
	});
});

// =============================================================================
// Compaction Hook — User-Level Memory
// =============================================================================

describe("createCompactionHook — user-level memory", () => {
	test("includes cross-project context when user memory enabled", async () => {
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			contextInjectionEnabled: true,
			maxContextTokens: 1000,
			userMemoryEnabled: true,
			userMemoryMaxContextTokens: 500,
		};
		const repos = {
			observations: { getIndex: () => [makeIndexEntry()] },
			sessions: { getRecent: () => [makeSession()] },
			summaries: { getBySessionId: () => makeSummary() },
		};
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "u1", title: "Cross-project fact", tokenCount: 5 }),
			],
		};
		const hook = createCompactionHook(
			config,
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		expect(output.context[0]).toContain("Cross-project observations");
		expect(output.context[0]).toContain("Cross-project fact");
	});

	test("omits cross-project context when user memory disabled", async () => {
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			contextInjectionEnabled: true,
			maxContextTokens: 1000,
			userMemoryEnabled: false,
		};
		const repos = {
			observations: { getIndex: () => [makeIndexEntry()] },
			sessions: { getRecent: () => [makeSession()] },
			summaries: { getBySessionId: () => makeSummary() },
		};
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "u1", title: "Should not appear", tokenCount: 5 }),
			],
		};
		const hook = createCompactionHook(
			config,
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		expect(output.context[0]).not.toContain("Cross-project");
		expect(output.context[0]).not.toContain("Should not appear");
	});
});
