import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { Database, createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { cosineSimilarity } from "../../src/search/embeddings";

const extensionEnabled = Database.enableExtensionSupport();
const DIMENSION = 8;

function createVecTestDb(): { db: Database; dbPath: string } {
	const dbPath = `/tmp/open-mem-quality-test-${randomUUID()}.db`;
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

function randomVector(dim: number): number[] {
	const v = Array.from({ length: dim }, () => Math.random() - 0.5);
	return normalize(v);
}

function similarVector(target: number[], noise: number): number[] {
	const v = target.map((x) => x + (Math.random() - 0.5) * noise);
	return normalize(v);
}

function seedObservation(
	observations: ObservationRepository,
	sessionId: string,
	title: string,
	embedding: number[],
	type: "discovery" | "bugfix" | "feature" | "refactor" | "decision" | "change" = "discovery",
): string {
	const obs = observations.create({
		sessionId,
		type,
		title,
		subtitle: "",
		facts: [],
		narrative: `Observation about ${title}`,
		concepts: [title.split(" ")[0].toLowerCase()],
		filesRead: [],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 20,
		discoveryTokens: 0,
	});

	observations.setEmbedding(obs.id, embedding);
	if (extensionEnabled) {
		observations.insertVecEmbedding(obs.id, embedding);
	}

	return obs.id;
}

function jsCosinSearch(
	observations: ObservationRepository,
	queryEmbedding: number[],
	projectPath: string,
	limit: number,
): Array<{ id: string; similarity: number }> {
	const candidates = observations.getWithEmbeddings(projectPath, limit * 10);
	return candidates
		.map((c) => ({
			id: c.id,
			similarity: cosineSimilarity(queryEmbedding, c.embedding),
		}))
		.filter(({ similarity }) => similarity >= 0.3)
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, limit);
}

describe("quality regression — vec0 vs JS cosine equivalence", () => {
	let db: Database;
	let dbPath: string;
	let observations: ObservationRepository;
	let sessions: SessionRepository;
	const projectPath = "/tmp/quality-test-proj";

	beforeEach(() => {
		const result = createVecTestDb();
		db = result.db;
		dbPath = result.dbPath;
		observations = new ObservationRepository(db);
		sessions = new SessionRepository(db);
		sessions.create("sess-quality", projectPath);
	});

	afterEach(() => {
		db.close();
		cleanupDb(dbPath);
	});

	test("top-K results contain the same observations from both paths", () => {
		if (!extensionEnabled) return;

		// Seed 20 observations with random embeddings
		const ids: string[] = [];
		const embeddings: number[][] = [];
		for (let i = 0; i < 20; i++) {
			const emb = randomVector(DIMENSION);
			embeddings.push(emb);
			ids.push(seedObservation(observations, "sess-quality", `Observation ${i}`, emb));
		}

		// Pick a query vector
		const queryEmb = randomVector(DIMENSION);

		// JS cosine path
		const jsResults = jsCosinSearch(observations, queryEmb, projectPath, 5);

		// vec0 KNN path
		const vec0Results = observations.getVecEmbeddingMatches(queryEmb, 5);

		// Both should return results
		expect(jsResults.length).toBeGreaterThan(0);
		expect(vec0Results.length).toBeGreaterThan(0);

		// Top-5 from both paths should overlap significantly
		const jsIds = new Set(jsResults.map((r) => r.id));
		const vec0Ids = new Set(vec0Results.map((r) => r.observationId));

		// At least 3 of top-5 should be the same (allowing for floating point differences)
		let overlap = 0;
		for (const id of jsIds) {
			if (vec0Ids.has(id)) overlap++;
		}
		expect(overlap).toBeGreaterThanOrEqual(3);
	});

	test("similar vectors cluster together in both paths", () => {
		if (!extensionEnabled) return;

		// Create 3 cluster centers
		const center1 = normalize([1, 0, 0, 0, 0, 0, 0, 0]);
		const center2 = normalize([0, 0, 0, 0, 1, 0, 0, 0]);
		const center3 = normalize([0, 0, 0, 0, 0, 0, 0, 1]);

		// Seed 5 observations per cluster with small noise
		const group1Ids: string[] = [];
		const group2Ids: string[] = [];
		const group3Ids: string[] = [];

		for (let i = 0; i < 5; i++) {
			group1Ids.push(
				seedObservation(
					observations,
					"sess-quality",
					`Group1 obs ${i}`,
					similarVector(center1, 0.2),
				),
			);
			group2Ids.push(
				seedObservation(
					observations,
					"sess-quality",
					`Group2 obs ${i}`,
					similarVector(center2, 0.2),
				),
			);
			group3Ids.push(
				seedObservation(
					observations,
					"sess-quality",
					`Group3 obs ${i}`,
					similarVector(center3, 0.2),
				),
			);
		}

		// Query close to center1
		const queryEmb = similarVector(center1, 0.05);

		// JS path
		const jsResults = jsCosinSearch(observations, queryEmb, projectPath, 5);
		const jsIds = new Set(jsResults.map((r) => r.id));

		// vec0 path
		const vec0Results = observations.getVecEmbeddingMatches(queryEmb, 5);
		const vec0Ids = new Set(vec0Results.map((r) => r.observationId));

		// Both paths should primarily return group1 observations
		const jsGroup1Count = group1Ids.filter((id) => jsIds.has(id)).length;
		const vec0Group1Count = group1Ids.filter((id) => vec0Ids.has(id)).length;

		expect(jsGroup1Count).toBeGreaterThanOrEqual(3);
		expect(vec0Group1Count).toBeGreaterThanOrEqual(3);
	});

	test("dissimilar vectors are excluded by both paths", () => {
		if (!extensionEnabled) return;

		// Create a query vector and some very different vectors
		const queryEmb = normalize([1, 0, 0, 0, 0, 0, 0, 0]);

		// Similar observation
		const similarEmb = normalize([0.95, 0.1, 0, 0, 0, 0, 0, 0]);
		const similarId = seedObservation(
			observations,
			"sess-quality",
			"Similar observation",
			similarEmb,
		);

		// Dissimilar observations (orthogonal/opposite)
		const dissimilarEmbs = [
			normalize([0, 0, 0, 0, 0, 0, 0, 1]),
			normalize([0, 0, 0, 0, 0, 0, 1, 0]),
			normalize([0, 0, 0, 0, 0, 1, 0, 0]),
			normalize([-1, 0, 0, 0, 0, 0, 0, 0]),
		];
		const dissimilarIds: string[] = [];
		for (let i = 0; i < dissimilarEmbs.length; i++) {
			dissimilarIds.push(
				seedObservation(observations, "sess-quality", `Dissimilar obs ${i}`, dissimilarEmbs[i]),
			);
		}

		// JS path: threshold >= 0.3 should exclude orthogonal/opposite vectors
		const jsResults = jsCosinSearch(observations, queryEmb, projectPath, 10);
		const jsIds = new Set(jsResults.map((r) => r.id));

		// The similar one should be included
		expect(jsIds.has(similarId)).toBe(true);

		// Orthogonal vectors (cosine ~0) should be excluded by JS threshold
		for (const dissId of dissimilarIds) {
			expect(jsIds.has(dissId)).toBe(false);
		}

		// vec0 path returns by distance (cosine distance: 0=identical, 1=orthogonal, 2=opposite)
		const vec0Results = observations.getVecEmbeddingMatches(queryEmb, 10);

		// Similar observation should be closest
		expect(vec0Results[0].observationId).toBe(similarId);
		expect(vec0Results[0].distance).toBeLessThan(0.2);

		// Dissimilar observations should have high distance
		for (const result of vec0Results) {
			if (dissimilarIds.includes(result.observationId)) {
				expect(result.distance).toBeGreaterThan(0.8);
			}
		}
	});

	test("empty database returns empty results from both paths", () => {
		// JS path
		const queryEmb = randomVector(DIMENSION);
		const jsResults = jsCosinSearch(observations, queryEmb, projectPath, 5);
		expect(jsResults).toEqual([]);

		// vec0 path (if available)
		if (extensionEnabled) {
			const vec0Results = observations.getVecEmbeddingMatches(queryEmb, 5);
			expect(vec0Results).toEqual([]);
		}
	});

	test("single observation returns the same result from both paths", () => {
		if (!extensionEnabled) return;

		const emb = normalize([1, 0, 0, 0, 0, 0, 0, 0]);
		const obsId = seedObservation(observations, "sess-quality", "Only observation", emb);

		// Query with the same embedding
		const jsResults = jsCosinSearch(observations, emb, projectPath, 5);
		expect(jsResults.length).toBe(1);
		expect(jsResults[0].id).toBe(obsId);
		expect(jsResults[0].similarity).toBeCloseTo(1.0, 2);

		const vec0Results = observations.getVecEmbeddingMatches(emb, 5);
		expect(vec0Results.length).toBe(1);
		expect(vec0Results[0].observationId).toBe(obsId);
		expect(vec0Results[0].distance).toBeCloseTo(0, 2);
	});

	test("both paths return valid SearchResult objects via hybridSearch", async () => {
		if (!extensionEnabled) return;

		const { hybridSearch } = await import("../../src/search/hybrid");

		// Seed observations
		const emb = normalize([1, 0, 0, 0, 0, 0, 0, 0]);
		for (let i = 0; i < 5; i++) {
			seedObservation(
				observations,
				"sess-quality",
				`Search result obs ${i}`,
				similarVector(emb, 0.3),
			);
		}

		const mockModel = {
			specificationVersion: "v3" as const,
			modelId: "test-model",
			provider: "test-provider",
			maxEmbeddingsPerCall: 1,
			supportsParallelCalls: false,
			doEmbed: async () => ({
				embeddings: [emb],
				warnings: [],
			}),
		};

		// vec0 path
		const vec0Results = await hybridSearch("search result", observations, mockModel, {
			projectPath,
			limit: 10,
			hasVectorExtension: true,
		});

		// JS fallback path
		const jsResults = await hybridSearch("search result", observations, mockModel, {
			projectPath,
			limit: 10,
			hasVectorExtension: false,
		});

		// Both should return results
		expect(vec0Results.length).toBeGreaterThan(0);
		expect(jsResults.length).toBeGreaterThan(0);

		// Both should have valid SearchResult shape
		for (const r of [...vec0Results, ...jsResults]) {
			expect(r.observation).toBeDefined();
			expect(r.observation.id).toBeDefined();
			expect(r.observation.title).toBeDefined();
			expect(typeof r.rank).toBe("number");
			expect(typeof r.snippet).toBe("string");
		}
	});

	test("RRF merge produces consistent results regardless of vector backend", async () => {
		if (!extensionEnabled) return;

		const { hybridSearch } = await import("../../src/search/hybrid");

		// Seed observations with FTS-matchable content and embeddings
		const baseEmb = normalize([1, 0, 0, 0, 0, 0, 0, 0]);
		for (let i = 0; i < 10; i++) {
			const obs = observations.create({
				sessionId: "sess-quality",
				type: "discovery",
				title: `Database optimization technique ${i}`,
				subtitle: "Performance tuning",
				facts: [`Fact ${i}`],
				narrative: `Detailed narrative about database optimization approach ${i}.`,
				concepts: ["database", "optimization"],
				filesRead: [`src/db/opt${i}.ts`],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 20,
				discoveryTokens: 0,
			});
			const emb = similarVector(baseEmb, 0.3);
			observations.setEmbedding(obs.id, emb);
			observations.insertVecEmbedding(obs.id, emb);
		}

		const mockModel = {
			specificationVersion: "v3" as const,
			modelId: "test-model",
			provider: "test-provider",
			maxEmbeddingsPerCall: 1,
			supportsParallelCalls: false,
			doEmbed: async () => ({
				embeddings: [baseEmb],
				warnings: [],
			}),
		};

		// Both paths with FTS query that matches
		const vec0Results = await hybridSearch("database optimization", observations, mockModel, {
			projectPath,
			limit: 5,
			hasVectorExtension: true,
		});

		const jsResults = await hybridSearch("database optimization", observations, mockModel, {
			projectPath,
			limit: 5,
			hasVectorExtension: false,
		});

		// Both should return results
		expect(vec0Results.length).toBeGreaterThan(0);
		expect(jsResults.length).toBeGreaterThan(0);

		// Results should overlap significantly (RRF merges FTS + vector)
		const vec0Ids = new Set(vec0Results.map((r) => r.observation.id));
		const jsIds = new Set(jsResults.map((r) => r.observation.id));

		let overlap = 0;
		for (const id of vec0Ids) {
			if (jsIds.has(id)) overlap++;
		}

		// At least 60% overlap in top-5 results
		const minOverlap = Math.ceil(Math.min(vec0Results.length, jsResults.length) * 0.6);
		expect(overlap).toBeGreaterThanOrEqual(minOverlap);
	});
});
