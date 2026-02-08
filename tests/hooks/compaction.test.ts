// =============================================================================
// open-mem — Enhanced Compaction Hook Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import {
	buildDecisionsSection,
	buildFullObservationsSection,
	createCompactionHook,
} from "../../src/hooks/compaction";
import type {
	Observation,
	ObservationIndex,
	OpenMemConfig,
	Session,
	SessionSummary,
} from "../../src/types";

function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
	return {
		...getDefaultConfig(),
		contextInjectionEnabled: true,
		maxContextTokens: 4000,
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
		id: "obs-idx-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		tokenCount: 5,
		discoveryTokens: 50,
		createdAt: "2026-01-01T00:00:00Z",
		importance: 3,
		...overrides,
	};
}

function makeObservation(overrides?: Partial<Observation>): Observation {
	return {
		id: "obs-full-1",
		sessionId: "sess-1",
		scope: "project",
		type: "discovery",
		title: "Found auth pattern",
		subtitle: "JWT auth in codebase",
		facts: ["Uses RS256 algorithm", "Token expires in 1h"],
		narrative: "The codebase uses JWT with RS256 for authentication.",
		concepts: ["JWT", "auth"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		rawToolOutput: "...",
		toolName: "read",
		createdAt: "2026-01-01T00:00:00Z",
		tokenCount: 15,
		discoveryTokens: 150,
		importance: 3,
		revisionOf: null,
		deletedAt: null,
		supersededBy: null,
		supersededAt: null,
		...overrides,
	};
}

function makeMockRepos(data?: {
	sessions?: Session[];
	summaries?: SessionSummary[];
	index?: ObservationIndex[];
	fullObservations?: Observation[];
}) {
	return {
		observations: {
			getIndex: () => data?.index ?? [],
			listByProject: () => data?.fullObservations ?? [],
		},
		sessions: {
			getRecent: () => data?.sessions ?? [],
		},
		summaries: {
			getBySessionId: (id: string) => data?.summaries?.find((s) => s.sessionId === id) ?? null,
		},
	};
}

// =============================================================================
// Enhanced Compaction Hook Tests
// =============================================================================

describe("createCompactionHook — enhanced observations", () => {
	test("injects context when observations exist", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: [makeObservation()],
		});
		const hook = createCompactionHook(
			makeConfig(),
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

	test("respects disabled context injection", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: [makeObservation()],
		});
		const hook = createCompactionHook(
			makeConfig({ contextInjectionEnabled: false }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(0);
	});

	test("includes recent observation details with full narratives", async () => {
		const obs = makeObservation({
			title: "Database migration strategy",
			narrative: "Use incremental migrations with rollback support.",
			facts: ["Alembic for Python", "drizzle-kit for TS"],
		});
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: [obs],
		});
		const hook = createCompactionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context[0]).toContain("Recent observation details:");
		expect(output.context[0]).toContain("Database migration strategy");
		expect(output.context[0]).toContain("Use incremental migrations with rollback support.");
		expect(output.context[0]).toContain("Alembic for Python; drizzle-kit for TS");
	});

	test("prioritizes decision-type observations", async () => {
		const decision = makeObservation({
			id: "decision-1",
			type: "decision",
			title: "Use PostgreSQL over MySQL",
			narrative: "PostgreSQL selected for JSONB support and better concurrency.",
		});
		const discovery = makeObservation({
			id: "discovery-1",
			type: "discovery",
			title: "Found legacy code",
			narrative: "Legacy module uses deprecated APIs.",
		});
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: [decision, discovery],
		});
		const hook = createCompactionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context[0]).toContain("Key decisions:");
		expect(output.context[0]).toContain("Use PostgreSQL over MySQL");
		expect(output.context[0]).toContain("PostgreSQL selected for JSONB");
	});

	test("token budget is respected — observations truncated when over budget", async () => {
		const largeObservations = Array.from({ length: 20 }, (_, i) =>
			makeObservation({
				id: `obs-${i}`,
				title: `Observation ${i}`,
				narrative: "A".repeat(500),
				facts: [],
			}),
		);
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: largeObservations,
		});
		const hook = createCompactionHook(
			makeConfig({ maxContextTokens: 200 }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		// With maxContextTokens=200, budget=100, observationBudget=40
		// Not all 20 observations should appear in full detail
		const fullText = output.context[0];
		const detailMatches = fullText.match(/Observation \d+/g) || [];
		expect(detailMatches.length).toBeLessThan(20);
	});

	test("handles empty observations gracefully", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [],
			index: [],
			fullObservations: [],
		});
		const hook = createCompactionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(0);
	});

	test("never throws on repository error", async () => {
		const brokenRepos = {
			observations: {
				getIndex: () => {
					throw new Error("DB error");
				},
				listByProject: () => [],
			},
			sessions: {
				getRecent: () => [makeSession()],
			},
			summaries: { getBySessionId: () => null },
		};
		const hook = createCompactionHook(
			makeConfig(),
			brokenRepos.observations as never,
			brokenRepos.sessions as never,
			brokenRepos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);
		expect(output.context).toHaveLength(0);
	});

	test("includes decisions section only for decision-type observations", async () => {
		const nonDecision = makeObservation({
			type: "feature",
			title: "Added new button",
			narrative: "A new submit button was added.",
		});
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
			fullObservations: [nonDecision],
		});
		const hook = createCompactionHook(
			makeConfig(),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context[0]).not.toContain("Key decisions:");
	});
});

// =============================================================================
// Helper function unit tests
// =============================================================================

describe("buildDecisionsSection", () => {
	test("returns empty string for no decisions", () => {
		expect(buildDecisionsSection([])).toBe("");
	});

	test("renders decisions with icon and narrative", () => {
		const decisions = [
			makeObservation({
				type: "decision",
				title: "Use Bun over Node",
				narrative: "Bun has faster startup and native TS support.",
			}),
		];
		const result = buildDecisionsSection(decisions);
		expect(result).toContain("Key decisions:");
		expect(result).toContain("⚖️");
		expect(result).toContain("Use Bun over Node");
		expect(result).toContain("Bun has faster startup");
	});
});

describe("buildFullObservationsSection", () => {
	test("returns empty string for no observations", () => {
		expect(buildFullObservationsSection([])).toBe("");
	});

	test("includes narratives and facts", () => {
		const obs = [
			makeObservation({
				title: "Test discovery",
				narrative: "Found important pattern.",
				facts: ["Fact A", "Fact B"],
			}),
		];
		const result = buildFullObservationsSection(obs);
		expect(result).toContain("Recent observation details:");
		expect(result).toContain("Test discovery");
		expect(result).toContain("Found important pattern.");
		expect(result).toContain("Fact A; Fact B");
	});
});
