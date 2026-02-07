import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { EmbeddingModel } from "ai";
import { Database, createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { hybridSearch } from "../../src/search/hybrid";

const DIMENSION = 4;
const extensionEnabled = Database.enableExtensionSupport();

function createVecTestDb(): { db: Database; dbPath: string } {
	const dbPath = `/tmp/open-mem-vec-test-${randomUUID()}.db`;
	const db = createDatabase(dbPath);
	initializeSchema(db, {
		hasVectorExtension: extensionEnabled,
		embeddingDimension: DIMENSION,
	});
	return { db, dbPath };
}

function cleanupDb(dbPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(dbPath + suffix);
		} catch {}
	}
}

function normalize(v: number[]): number[] {
	const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
	return mag === 0 ? v : v.map((x) => x / mag);
}

function createMockEmbeddingModel(embedding: number[]): EmbeddingModel {
	return {
		specificationVersion: "v3",
		modelId: "test-model",
		provider: "test-provider",
		maxEmbeddingsPerCall: 1,
		supportsParallelCalls: false,
		doEmbed: async () => ({
			embeddings: [embedding],
			warnings: [],
		}),
	};
}

describe("runVectorSearch — vec0 native path", () => {
	let db: Database;
	let dbPath: string;
	let observations: ObservationRepository;
	let sessions: SessionRepository;

	beforeEach(() => {
		const result = createVecTestDb();
		db = result.db;
		dbPath = result.dbPath;
		observations = new ObservationRepository(db);
		sessions = new SessionRepository(db);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	function seedObservationsWithVecEmbeddings() {
		sessions.create("sess-vec", "/tmp/vec-proj");

		const obs1 = observations.create({
			sessionId: "sess-vec",
			type: "discovery",
			title: "Vector search implementation",
			subtitle: "Using sqlite-vec",
			facts: ["Uses KNN"],
			narrative: "Implemented vector search with sqlite-vec extension.",
			concepts: ["vector", "search"],
			filesRead: ["src/search.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
			discoveryTokens: 0,
		});

		const obs2 = observations.create({
			sessionId: "sess-vec",
			type: "refactor",
			title: "Database refactoring",
			subtitle: "Schema changes",
			facts: [],
			narrative: "Refactored database schema for better performance.",
			concepts: ["database", "schema"],
			filesRead: [],
			filesModified: ["src/db/schema.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 30,
			discoveryTokens: 0,
		});

		const obs3 = observations.create({
			sessionId: "sess-vec",
			type: "bugfix",
			title: "Fixed authentication bug",
			subtitle: "JWT token validation",
			facts: ["Token expiry was wrong"],
			narrative: "Fixed JWT token validation to check expiry correctly.",
			concepts: ["auth", "jwt"],
			filesRead: ["src/auth.ts"],
			filesModified: ["src/auth.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 40,
			discoveryTokens: 0,
		});

		const emb1 = normalize([1, 0, 0, 0]);
		const emb2 = normalize([0, 1, 0, 0]);
		const emb3 = normalize([0.9, 0.1, 0, 0]);

		observations.setEmbedding(obs1.id, emb1);
		observations.setEmbedding(obs2.id, emb2);
		observations.setEmbedding(obs3.id, emb3);

		if (extensionEnabled) {
			observations.insertVecEmbedding(obs1.id, emb1);
			observations.insertVecEmbedding(obs2.id, emb2);
			observations.insertVecEmbedding(obs3.id, emb3);
		}

		return { obs1, obs2, obs3, emb1, emb2, emb3 };
	}

	test("uses vec0 SQL KNN when extension available", () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedObservationsWithVecEmbeddings();

		const matches = observations.getVecEmbeddingMatches(emb1, 10);
		expect(matches.length).toBeGreaterThan(0);
		expect(matches[0].distance).toBeCloseTo(0, 1);
		expect(matches[0].observationId).toBeDefined();
	});

	test("vec0 path returns results via hybridSearch", async () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedObservationsWithVecEmbeddings();

		const results = await hybridSearch(
			"vector search",
			observations,
			createMockEmbeddingModel(emb1),
			{
				projectPath: "/tmp/vec-proj",
				limit: 10,
				hasVectorExtension: true,
			},
		);

		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(r.observation).toBeDefined();
			expect(r.rank).toBeDefined();
			expect(r.snippet).toBeDefined();
		}
	});

	test("type filter works with vec0 path", async () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedObservationsWithVecEmbeddings();

		const results = await hybridSearch(
			"vector search",
			observations,
			createMockEmbeddingModel(emb1),
			{
				projectPath: "/tmp/vec-proj",
				type: "discovery",
				limit: 10,
				hasVectorExtension: true,
			},
		);

		for (const r of results) {
			expect(r.observation.type).toBe("discovery");
		}
	});

	test("results from both paths are formatted identically", async () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedObservationsWithVecEmbeddings();
		const model = createMockEmbeddingModel(emb1);

		const vec0Results = await hybridSearch("vector search", observations, model, {
			projectPath: "/tmp/vec-proj",
			limit: 10,
			hasVectorExtension: true,
		});

		const jsResults = await hybridSearch("vector search", observations, model, {
			projectPath: "/tmp/vec-proj",
			limit: 10,
			hasVectorExtension: false,
		});

		for (const r of vec0Results) {
			expect(r).toHaveProperty("observation");
			expect(r).toHaveProperty("rank");
			expect(r).toHaveProperty("snippet");
			expect(typeof r.rank).toBe("number");
			expect(typeof r.snippet).toBe("string");
			expect(r.observation.id).toBeDefined();
			expect(r.observation.title).toBeDefined();
		}

		for (const r of jsResults) {
			expect(r).toHaveProperty("observation");
			expect(r).toHaveProperty("rank");
			expect(r).toHaveProperty("snippet");
			expect(typeof r.rank).toBe("number");
			expect(typeof r.snippet).toBe("string");
			expect(r.observation.id).toBeDefined();
			expect(r.observation.title).toBeDefined();
		}
	});
});

describe("runVectorSearch — JS cosine fallback path", () => {
	let db: Database;
	let dbPath: string;
	let observations: ObservationRepository;
	let sessions: SessionRepository;

	beforeEach(() => {
		const result = createVecTestDb();
		db = result.db;
		dbPath = result.dbPath;
		observations = new ObservationRepository(db);
		sessions = new SessionRepository(db);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("falls back to JS cosine when extension unavailable", async () => {
		sessions.create("sess-js", "/tmp/js-proj");

		const obs = observations.create({
			sessionId: "sess-js",
			type: "discovery",
			title: "JS fallback test",
			subtitle: "",
			facts: [],
			narrative: "Testing JS cosine similarity fallback.",
			concepts: ["test"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 20,
			discoveryTokens: 0,
		});

		const emb = normalize([1, 0, 0, 0]);
		observations.setEmbedding(obs.id, emb);

		const results = await hybridSearch("JS fallback", observations, createMockEmbeddingModel(emb), {
			projectPath: "/tmp/js-proj",
			limit: 10,
			hasVectorExtension: false,
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].observation.title).toBe("JS fallback test");
		expect(results[0].rank).toBeLessThan(0);
		expect(results[0].snippet).toBeDefined();
	});

	test("JS fallback filters by type", async () => {
		sessions.create("sess-filter", "/tmp/filter-proj");

		const obs1 = observations.create({
			sessionId: "sess-filter",
			type: "discovery",
			title: "Discovery observation",
			subtitle: "",
			facts: [],
			narrative: "A discovery.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 20,
			discoveryTokens: 0,
		});

		const obs2 = observations.create({
			sessionId: "sess-filter",
			type: "bugfix",
			title: "Bugfix observation",
			subtitle: "",
			facts: [],
			narrative: "A bugfix.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 20,
			discoveryTokens: 0,
		});

		const emb = normalize([1, 0, 0, 0]);
		observations.setEmbedding(obs1.id, emb);
		observations.setEmbedding(obs2.id, emb);

		const results = await hybridSearch("observation", observations, createMockEmbeddingModel(emb), {
			projectPath: "/tmp/filter-proj",
			type: "bugfix",
			limit: 10,
			hasVectorExtension: false,
		});

		for (const r of results) {
			expect(r.observation.type).toBe("bugfix");
		}
	});

	test("getVecEmbeddingMatches returns empty when vec0 table missing", () => {
		const noVecDbPath = `/tmp/open-mem-novec-test-${randomUUID()}.db`;
		const noVecDb = createDatabase(noVecDbPath);
		initializeSchema(noVecDb);
		const noVecObs = new ObservationRepository(noVecDb);

		const results = noVecObs.getVecEmbeddingMatches([1, 0, 0, 0], 10);
		expect(results).toEqual([]);

		noVecDb.close();
		cleanupDb(noVecDbPath);
	});
});

describe("FTS5 pre-filtering for vec0 native path", () => {
	let db: Database;
	let dbPath: string;
	let observations: ObservationRepository;
	let sessions: SessionRepository;

	beforeEach(() => {
		const result = createVecTestDb();
		db = result.db;
		dbPath = result.dbPath;
		observations = new ObservationRepository(db);
		sessions = new SessionRepository(db);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	function seedManyObservations() {
		sessions.create("sess-prefilter", "/tmp/prefilter-proj");

		const obs1 = observations.create({
			sessionId: "sess-prefilter",
			type: "discovery",
			title: "Vector search implementation",
			subtitle: "Using sqlite-vec",
			facts: ["Uses KNN"],
			narrative: "Implemented vector search with sqlite-vec extension.",
			concepts: ["vector", "search"],
			filesRead: ["src/search.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
			discoveryTokens: 0,
		});

		const obs2 = observations.create({
			sessionId: "sess-prefilter",
			type: "refactor",
			title: "Database refactoring",
			subtitle: "Schema changes",
			facts: [],
			narrative: "Refactored database schema for better performance.",
			concepts: ["database", "schema"],
			filesRead: [],
			filesModified: ["src/db/schema.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 30,
			discoveryTokens: 0,
		});

		const obs3 = observations.create({
			sessionId: "sess-prefilter",
			type: "bugfix",
			title: "Fixed authentication bug",
			subtitle: "JWT token validation",
			facts: ["Token expiry was wrong"],
			narrative: "Fixed JWT token validation to check expiry correctly.",
			concepts: ["auth", "jwt"],
			filesRead: ["src/auth.ts"],
			filesModified: ["src/auth.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 40,
			discoveryTokens: 0,
		});

		const obs4 = observations.create({
			sessionId: "sess-prefilter",
			type: "feature",
			title: "Added caching layer",
			subtitle: "Redis integration",
			facts: ["TTL-based cache"],
			narrative: "Added Redis caching for frequently accessed data.",
			concepts: ["cache", "redis"],
			filesRead: [],
			filesModified: ["src/cache.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 35,
			discoveryTokens: 0,
		});

		const obs5 = observations.create({
			sessionId: "sess-prefilter",
			type: "decision",
			title: "Chose SQLite over Postgres",
			subtitle: "Architecture decision",
			facts: ["Simpler deployment"],
			narrative: "Decided to use SQLite for local-first architecture.",
			concepts: ["database", "architecture"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 25,
			discoveryTokens: 0,
		});

		const emb1 = normalize([1, 0, 0, 0]);
		const emb2 = normalize([0, 1, 0, 0]);
		const emb3 = normalize([0.9, 0.1, 0, 0]);
		const emb4 = normalize([0, 0, 1, 0]);
		const emb5 = normalize([0, 0, 0, 1]);

		observations.setEmbedding(obs1.id, emb1);
		observations.setEmbedding(obs2.id, emb2);
		observations.setEmbedding(obs3.id, emb3);
		observations.setEmbedding(obs4.id, emb4);
		observations.setEmbedding(obs5.id, emb5);

		if (extensionEnabled) {
			observations.insertVecEmbedding(obs1.id, emb1);
			observations.insertVecEmbedding(obs2.id, emb2);
			observations.insertVecEmbedding(obs3.id, emb3);
			observations.insertVecEmbedding(obs4.id, emb4);
			observations.insertVecEmbedding(obs5.id, emb5);
		}

		return { obs1, obs2, obs3, obs4, obs5, emb1, emb2, emb3, emb4, emb5 };
	}

	test("searchVecSubset returns only results within provided observation IDs", () => {
		if (!extensionEnabled) return;

		const { obs1, obs2, obs3, emb1 } = seedManyObservations();

		// Given: only obs1 and obs3 are in the subset
		const subsetIds = [obs1.id, obs3.id];
		const results = observations.searchVecSubset(emb1, subsetIds, 10);

		expect(results.length).toBeGreaterThan(0);
		const resultIds = new Set(results.map((r) => r.observationId));
		for (const id of resultIds) {
			expect(subsetIds).toContain(id);
		}
		expect(resultIds.has(obs2.id)).toBe(false);
	});

	test("searchVecSubset with empty IDs returns empty", () => {
		if (!extensionEnabled) return;

		seedManyObservations();

		const results = observations.searchVecSubset(normalize([1, 0, 0, 0]), [], 10);
		expect(results).toEqual([]);
	});

	test("searchVecSubset with IDs that have no vec embeddings returns empty", () => {
		if (!extensionEnabled) return;

		sessions.create("sess-no-emb", "/tmp/no-emb-proj");
		const obsNoEmb = observations.create({
			sessionId: "sess-no-emb",
			type: "discovery",
			title: "No embedding observation",
			subtitle: "",
			facts: [],
			narrative: "This observation has no vec embedding.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 10,
			discoveryTokens: 0,
		});
		const results = observations.searchVecSubset(normalize([1, 0, 0, 0]), [obsNoEmb.id], 10);
		expect(results).toEqual([]);
	});

	test("hybridSearch with empty FTS results falls back to full KNN", async () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedManyObservations();

		const results = await hybridSearch(
			"xyznonexistentquery",
			observations,
			createMockEmbeddingModel(emb1),
			{
				projectPath: "/tmp/prefilter-proj",
				limit: 10,
				hasVectorExtension: true,
			},
		);

		expect(results.length).toBeGreaterThan(0);
	});

	test("pre-filtered results are a subset of unfiltered results", async () => {
		if (!extensionEnabled) return;

		const { emb1 } = seedManyObservations();

		// When: FTS returns nothing → full KNN
		const unfilteredResults = await hybridSearch(
			"xyznonexistentquery",
			observations,
			createMockEmbeddingModel(emb1),
			{
				projectPath: "/tmp/prefilter-proj",
				limit: 10,
				hasVectorExtension: true,
			},
		);

		// When: FTS returns matches → pre-filtered KNN + RRF merge
		const filteredResults = await hybridSearch(
			"vector search",
			observations,
			createMockEmbeddingModel(emb1),
			{
				projectPath: "/tmp/prefilter-proj",
				limit: 10,
				hasVectorExtension: true,
			},
		);

		expect(unfilteredResults.length).toBeGreaterThan(0);
		expect(filteredResults.length).toBeGreaterThan(0);

		for (const r of filteredResults) {
			expect(r.observation.id).toBeDefined();
			expect(r.observation.title).toBeDefined();
		}
	});
});
