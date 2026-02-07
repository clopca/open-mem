import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { EmbeddingModel } from "ai";
import { type Database, createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { hybridSearch } from "../../src/search/hybrid";

const DIMENSION = 4;

function createNoVecTestDb(): { db: Database; dbPath: string } {
	const dbPath = `/tmp/open-mem-fallback-test-${randomUUID()}.db`;
	const db = createDatabase(dbPath);
	initializeSchema(db);
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

describe("fallback — search without sqlite-vec", () => {
	let db: Database;
	let dbPath: string;
	let observations: ObservationRepository;
	let sessions: SessionRepository;
	const projectPath = "/tmp/fallback-test-proj";

	beforeEach(() => {
		const result = createNoVecTestDb();
		db = result.db;
		dbPath = result.dbPath;
		observations = new ObservationRepository(db);
		sessions = new SessionRepository(db);
		sessions.create("sess-fallback", projectPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("JS cosine fallback works when hasVectorExtension is false", async () => {
		const emb = normalize([1, 0, 0, 0]);

		const obs = observations.create({
			sessionId: "sess-fallback",
			type: "discovery",
			title: "Fallback search test observation",
			subtitle: "Testing JS cosine path",
			facts: ["Uses JS cosine"],
			narrative: "This observation tests the JS cosine similarity fallback path.",
			concepts: ["fallback", "search"],
			filesRead: ["src/search.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 30,
			discoveryTokens: 0,
		});

		observations.setEmbedding(obs.id, emb);

		const results = await hybridSearch(
			"fallback search",
			observations,
			createMockEmbeddingModel(emb),
			{
				projectPath,
				limit: 10,
				hasVectorExtension: false,
			},
		);

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].observation.id).toBe(obs.id);
		expect(results[0].observation.title).toBe("Fallback search test observation");
		expect(typeof results[0].rank).toBe("number");
		expect(typeof results[0].snippet).toBe("string");
	});

	test("FTS-only results when no embedding model provided", async () => {
		observations.create({
			sessionId: "sess-fallback",
			type: "discovery",
			title: "FTS only test observation",
			subtitle: "No embeddings needed",
			facts: [],
			narrative: "This observation should be found via FTS5 full-text search only.",
			concepts: ["fts", "search"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 20,
			discoveryTokens: 0,
		});

		const results = await hybridSearch("FTS only test", observations, null, {
			projectPath,
			limit: 10,
			hasVectorExtension: false,
		});

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].observation.title).toBe("FTS only test observation");
	});

	test("no errors when vec0 table does not exist", () => {
		const queryEmb = normalize([1, 0, 0, 0]);
		const results = observations.getVecEmbeddingMatches(queryEmb, 10);
		expect(results).toEqual([]);
	});

	test("graceful handling when observations have no embeddings", async () => {
		observations.create({
			sessionId: "sess-fallback",
			type: "feature",
			title: "No embedding observation for graceful test",
			subtitle: "",
			facts: [],
			narrative: "This observation has no embedding set at all.",
			concepts: ["graceful"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 15,
			discoveryTokens: 0,
		});

		const emb = normalize([1, 0, 0, 0]);

		// hybridSearch with embedding model but no stored embeddings → FTS-only results
		const results = await hybridSearch(
			"graceful test",
			observations,
			createMockEmbeddingModel(emb),
			{
				projectPath,
				limit: 10,
				hasVectorExtension: false,
			},
		);

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].observation.title).toBe("No embedding observation for graceful test");
	});
});
