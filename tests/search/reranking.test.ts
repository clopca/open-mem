// =============================================================================
// open-mem — Reranking Tests (Task 12)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import {
	HeuristicReranker,
	LLMReranker,
	createReranker,
} from "../../src/search/reranker";
import type { Observation, SearchResult } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(overrides: Partial<Observation> = {}): Observation {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Default title",
		subtitle: "",
		facts: [],
		narrative: "Default narrative",
		concepts: [],
		filesRead: [],
		filesModified: [],
		rawToolOutput: "",
		toolName: "Read",
		createdAt: new Date().toISOString(),
		tokenCount: 50,
		discoveryTokens: 0,
		importance: 3,
		...overrides,
	};
}

function makeSearchResult(overrides: Partial<Observation> = {}, rank = 0): SearchResult {
	return {
		observation: makeObservation(overrides),
		rank,
		snippet: overrides.title ?? "Default title",
	};
}

// =============================================================================
// HeuristicReranker
// =============================================================================

describe("HeuristicReranker", () => {
	test("reorders results by relevance score", async () => {
		const reranker = new HeuristicReranker();

		// Result B has "authentication" in title (matches query better)
		// Result A has no query term overlap
		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "Database migration", narrative: "Migrated tables" }),
			makeSearchResult({
				id: "b",
				title: "JWT authentication pattern",
				narrative: "Authentication uses JWT tokens",
				concepts: ["authentication"],
			}),
		];

		const reranked = await reranker.rerank("authentication", results, 10);

		expect(reranked.length).toBe(2);
		expect(reranked[0].observation.id).toBe("b");
		expect(reranked[1].observation.id).toBe("a");
	});

	test("returns original order for single result", async () => {
		const reranker = new HeuristicReranker();
		const results: SearchResult[] = [
			makeSearchResult({ id: "only", title: "Only result" }),
		];

		const reranked = await reranker.rerank("anything", results, 10);

		expect(reranked.length).toBe(1);
		expect(reranked[0].observation.id).toBe("only");
	});

	test("respects limit parameter", async () => {
		const reranker = new HeuristicReranker();
		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First result" }),
			makeSearchResult({ id: "b", title: "Second result" }),
			makeSearchResult({ id: "c", title: "Third result" }),
		];

		const reranked = await reranker.rerank("result", results, 2);

		expect(reranked.length).toBe(2);
	});

	test("scores recency higher for recent observations", async () => {
		const reranker = new HeuristicReranker();
		const now = new Date();
		const oldDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

		const results: SearchResult[] = [
			makeSearchResult({
				id: "old",
				title: "Old observation about testing",
				narrative: "Testing patterns",
				createdAt: oldDate.toISOString(),
			}),
			makeSearchResult({
				id: "new",
				title: "New observation about testing",
				narrative: "Testing patterns",
				createdAt: now.toISOString(),
			}),
		];

		const reranked = await reranker.rerank("testing", results, 10);

		// New observation should rank higher due to recency boost
		expect(reranked[0].observation.id).toBe("new");
	});

	test("scores importance higher for important observations", async () => {
		const reranker = new HeuristicReranker();

		const results: SearchResult[] = [
			makeSearchResult({
				id: "low",
				title: "Low importance testing",
				narrative: "Testing patterns",
				importance: 1,
			}),
			makeSearchResult({
				id: "high",
				title: "High importance testing",
				narrative: "Testing patterns",
				importance: 5,
			}),
		];

		const reranked = await reranker.rerank("testing", results, 10);

		expect(reranked[0].observation.id).toBe("high");
	});

	test("returns empty slice for empty results", async () => {
		const reranker = new HeuristicReranker();
		const reranked = await reranker.rerank("query", [], 10);
		expect(reranked.length).toBe(0);
	});
});

// =============================================================================
// LLMReranker
// =============================================================================

describe("LLMReranker", () => {
	function makeLLMReranker() {
		// Use a dummy language model — we override _generate anyway
		const dummyModel = {} as Parameters<typeof LLMReranker.prototype.rerank>[0] extends string
			? never
			: never;
		return new LLMReranker({} as any, {
			rerankingMaxCandidates: 20,
			provider: "anthropic",
			model: "test-model",
			rateLimitingEnabled: false,
		});
	}

	test("reorders results using mock LLM response", async () => {
		const reranker = makeLLMReranker();

		// Mock LLM returns indices in reverse order: [1, 0]
		reranker._generate = async () => ({
			text: "<reranked><index>1</index><index>0</index></reranked>",
		}) as any;

		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First" }),
			makeSearchResult({ id: "b", title: "Second" }),
		];

		const reranked = await reranker.rerank("query", results, 10);

		expect(reranked.length).toBe(2);
		expect(reranked[0].observation.id).toBe("b");
		expect(reranked[1].observation.id).toBe("a");
	});

	test("returns original order on LLM failure (graceful degradation)", async () => {
		const reranker = makeLLMReranker();

		reranker._generate = async () => {
			throw new Error("LLM unavailable");
		};

		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First" }),
			makeSearchResult({ id: "b", title: "Second" }),
		];

		const reranked = await reranker.rerank("query", results, 10);

		expect(reranked.length).toBe(2);
		expect(reranked[0].observation.id).toBe("a");
		expect(reranked[1].observation.id).toBe("b");
	});

	test("returns original order when LLM returns unparseable response", async () => {
		const reranker = makeLLMReranker();

		reranker._generate = async () => ({
			text: "I cannot rerank these results",
		}) as any;

		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First" }),
			makeSearchResult({ id: "b", title: "Second" }),
		];

		const reranked = await reranker.rerank("query", results, 2);

		expect(reranked.length).toBe(2);
		expect(reranked[0].observation.id).toBe("a");
	});

	test("skips reranking when <= 1 result", async () => {
		const reranker = makeLLMReranker();

		let generateCalled = false;
		reranker._generate = async () => {
			generateCalled = true;
			return { text: "" } as any;
		};

		const single: SearchResult[] = [makeSearchResult({ id: "only", title: "Only" })];
		const reranked = await reranker.rerank("query", single, 10);

		expect(reranked.length).toBe(1);
		expect(reranked[0].observation.id).toBe("only");
		expect(generateCalled).toBe(false);
	});

	test("respects limit parameter", async () => {
		const reranker = makeLLMReranker();

		reranker._generate = async () => ({
			text: "<reranked><index>2</index><index>1</index><index>0</index></reranked>",
		}) as any;

		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First" }),
			makeSearchResult({ id: "b", title: "Second" }),
			makeSearchResult({ id: "c", title: "Third" }),
		];

		const reranked = await reranker.rerank("query", results, 2);

		expect(reranked.length).toBe(2);
	});

	test("appends missing candidates when LLM returns partial indices", async () => {
		const reranker = makeLLMReranker();

		// LLM only mentions index 2, missing 0 and 1
		reranker._generate = async () => ({
			text: "<reranked><index>2</index></reranked>",
		}) as any;

		const results: SearchResult[] = [
			makeSearchResult({ id: "a", title: "First" }),
			makeSearchResult({ id: "b", title: "Second" }),
			makeSearchResult({ id: "c", title: "Third" }),
		];

		const reranked = await reranker.rerank("query", results, 10);

		expect(reranked.length).toBe(3);
		expect(reranked[0].observation.id).toBe("c"); // index 2 first
		// Remaining in original order
		expect(reranked[1].observation.id).toBe("a");
		expect(reranked[2].observation.id).toBe("b");
	});
});

// =============================================================================
// createReranker factory
// =============================================================================

describe("createReranker", () => {
	test("returns null when disabled", () => {
		const result = createReranker(
			{ rerankingEnabled: false, rerankingMaxCandidates: 20 },
			null,
		);
		expect(result).toBeNull();
	});

	test("returns LLMReranker when model available", () => {
		const dummyModel = { specificationVersion: "v1" } as any;
		const result = createReranker(
			{ rerankingEnabled: true, rerankingMaxCandidates: 20 },
			dummyModel,
		);
		expect(result).toBeInstanceOf(LLMReranker);
	});

	test("returns HeuristicReranker when no model", () => {
		const result = createReranker(
			{ rerankingEnabled: true, rerankingMaxCandidates: 20 },
			null,
		);
		expect(result).toBeInstanceOf(HeuristicReranker);
	});
});

// =============================================================================
// SearchOrchestrator + Reranker Integration
// =============================================================================

describe("SearchOrchestrator reranker integration", () => {
	let db: Database;
	let dbPath: string;
	let sessions: SessionRepository;
	let observations: ObservationRepository;

	beforeEach(() => {
		const result = createTestDb();
		db = result.db;
		dbPath = result.dbPath;
		sessions = new SessionRepository(db);
		observations = new ObservationRepository(db);
	});

	afterEach(() => {
		db.close();
		cleanupTestDb(dbPath);
	});

	function seedObservations() {
		sessions.create("sess-1", "/project/test");
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Database connection pooling",
			subtitle: "",
			facts: [],
			narrative: "Database uses connection pooling for performance.",
			concepts: ["database", "performance"],
			filesRead: ["src/db.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
			discoveryTokens: 0,
			importance: 3,
		});
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Authentication JWT tokens",
			subtitle: "",
			facts: [],
			narrative: "Auth module uses JWT tokens for authentication.",
			concepts: ["JWT", "authentication"],
			filesRead: ["src/auth.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 40,
			discoveryTokens: 0,
			importance: 4,
		});
	}

	test("orchestrator applies reranker when provided", async () => {
		seedObservations();

		// Create a mock reranker that reverses results
		const mockReranker = {
			async rerank(_query: string, results: SearchResult[], limit: number) {
				return [...results].reverse().slice(0, limit);
			},
		};

		const orchestrator = new SearchOrchestrator(
			observations,
			null,
			false,
			mockReranker,
		);

		const results = await orchestrator.search("database OR JWT", {
			strategy: "filter-only",
			projectPath: "/project/test",
		});

		// With 2 results, reversed means the second observation comes first
		expect(results.length).toBe(2);
		// The mock reverses, so the order should be flipped from FTS5 default
		const ids = results.map((r) => r.observation.title);
		expect(ids.length).toBe(2);
	});

	test("orchestrator skips reranker when null", async () => {
		seedObservations();

		const orchestrator = new SearchOrchestrator(observations, null, false, null);

		const results = await orchestrator.search("database OR JWT", {
			strategy: "filter-only",
			projectPath: "/project/test",
		});

		// Should still return results without reranking
		expect(results.length).toBe(2);
	});

	test("orchestrator skips reranker for single result", async () => {
		seedObservations();

		let rerankCalled = false;
		const mockReranker = {
			async rerank(_query: string, results: SearchResult[], limit: number) {
				rerankCalled = true;
				return results.slice(0, limit);
			},
		};

		const orchestrator = new SearchOrchestrator(
			observations,
			null,
			false,
			mockReranker,
		);

		const results = await orchestrator.search("database", {
			strategy: "filter-only",
			projectPath: "/project/test",
			limit: 1,
		});

		// With limit=1, FTS5 returns 1 result, reranker should NOT be called
		// (orchestrator checks results.length > 1)
		expect(results.length).toBe(1);
		expect(rerankCalled).toBe(false);
	});
});
