// =============================================================================
// open-mem — Hybrid Search & Embeddings Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { cosineSimilarity, prepareObservationText } from "../../src/search/embeddings";
import { hybridSearch } from "../../src/search/hybrid";
import { cleanupTestDb, createTestDb } from "../db/helpers";

// =============================================================================
// cosineSimilarity
// =============================================================================

describe("cosineSimilarity", () => {
	test("returns 1.0 for identical vectors", () => {
		const v = [1, 2, 3, 4, 5];
		const result = cosineSimilarity(v, v);
		expect(result).toBeCloseTo(1.0, 5);
	});

	test("returns 0 for orthogonal vectors", () => {
		const a = [1, 0, 0];
		const b = [0, 1, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
	});

	test("returns 0 for zero-length vectors", () => {
		expect(cosineSimilarity([], [])).toBe(0);
	});

	test("returns 0 for different-length vectors", () => {
		expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
	});

	test("returns 0 for zero vectors", () => {
		expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
	});

	test("returns -1 for opposite vectors", () => {
		const a = [1, 0, 0];
		const b = [-1, 0, 0];
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
	});

	test("handles normalized vectors correctly", () => {
		const a = [0.6, 0.8];
		const b = [0.8, 0.6];
		const result = cosineSimilarity(a, b);
		expect(result).toBeGreaterThan(0);
		expect(result).toBeLessThan(1);
	});
});

// =============================================================================
// prepareObservationText
// =============================================================================

describe("prepareObservationText", () => {
	test("combines title, narrative, and concepts", () => {
		const result = prepareObservationText({
			title: "My Title",
			narrative: "My Narrative",
			concepts: ["concept1", "concept2"],
		});
		expect(result).toContain("My Title");
		expect(result).toContain("My Narrative");
		expect(result).toContain("concept1, concept2");
	});

	test("omits concepts section when empty", () => {
		const result = prepareObservationText({
			title: "Title",
			narrative: "Narrative",
			concepts: [],
		});
		expect(result).toBe("Title\nNarrative");
	});

	test("joins parts with newlines", () => {
		const result = prepareObservationText({
			title: "T",
			narrative: "N",
			concepts: ["c"],
		});
		const lines = result.split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("T");
		expect(lines[1]).toBe("N");
		expect(lines[2]).toBe("c");
	});
});

// =============================================================================
// hybridSearch (FTS5 fallback)
// =============================================================================

describe("hybridSearch", () => {
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

	function seedSearchData() {
		sessions.create("sess-1", "/tmp/proj");
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Found JWT authentication pattern",
			subtitle: "In auth module",
			facts: ["Uses RS256"],
			narrative: "The auth module uses JWT tokens with RS256 algorithm.",
			concepts: ["JWT", "authentication"],
			filesRead: ["src/auth.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
			discoveryTokens: 0,
		});
		observations.create({
			sessionId: "sess-1",
			type: "refactor",
			title: "React component refactoring",
			subtitle: "",
			facts: [],
			narrative: "Refactored the React component to use hooks.",
			concepts: ["react", "hooks"],
			filesRead: [],
			filesModified: ["src/App.tsx"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 30,
			discoveryTokens: 0,
		});
	}

	test("falls back to FTS5 when embeddingModel is null", async () => {
		seedSearchData();
		const results = await hybridSearch("JWT authentication", observations, null, {
			projectPath: "/tmp/proj",
			limit: 10,
		});
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].observation.title).toContain("JWT");
	});

	test("returns empty for non-matching query with null embeddingModel", async () => {
		seedSearchData();
		const results = await hybridSearch("xyznonexistent", observations, null, {
			projectPath: "/tmp/proj",
			limit: 10,
		});
		expect(results).toHaveLength(0);
	});

	test("respects type filter in FTS5 fallback", async () => {
		seedSearchData();
		const results = await hybridSearch("JWT", observations, null, {
			projectPath: "/tmp/proj",
			type: "discovery",
			limit: 10,
		});
		for (const r of results) {
			expect(r.observation.type).toBe("discovery");
		}
	});

	test("respects limit in FTS5 fallback", async () => {
		seedSearchData();
		const results = await hybridSearch("JWT OR React", observations, null, {
			projectPath: "/tmp/proj",
			limit: 1,
		});
		expect(results.length).toBeLessThanOrEqual(1);
	});

	test("returns results with rank and snippet", async () => {
		seedSearchData();
		const results = await hybridSearch("JWT", observations, null, {
			projectPath: "/tmp/proj",
		});
		if (results.length > 0) {
			expect(results[0].rank).toBeDefined();
			expect(results[0].snippet).toBeDefined();
			expect(results[0].observation).toBeDefined();
		}
	});
});
