// =============================================================================
// open-mem — Embedding-Based Deduplication Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EmbeddingModel } from "ai";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { QueueProcessor } from "../../src/queue/processor";
import type { Observation, ObservationType } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let pendingRepo: PendingMessageRepository;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;
let compressor: ObservationCompressor;
let summarizer: SessionSummarizer;

function createMockEmbeddingModel(embedding: number[]): EmbeddingModel {
	return {
		specificationVersion: "v3",
		modelId: "test-embed",
		provider: "test-provider",
		maxEmbeddingsPerCall: 1,
		supportsParallelCalls: false,
		doEmbed: async () => ({
			embeddings: [embedding],
			warnings: [],
		}),
	};
}

function createFailingEmbeddingModel(): EmbeddingModel {
	return {
		specificationVersion: "v3",
		modelId: "test-embed-fail",
		provider: "test-provider",
		maxEmbeddingsPerCall: 1,
		supportsParallelCalls: false,
		doEmbed: async () => {
			throw new Error("Embedding generation failed");
		},
	};
}

function normalize(v: number[]): number[] {
	const mag = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
	return mag === 0 ? v : v.map((x) => x / mag);
}

function buildProcessor(embeddingModel: EmbeddingModel | null = null) {
	return new QueueProcessor(
		{ batchSize: 10, batchIntervalMs: 60_000 },
		compressor,
		summarizer,
		pendingRepo,
		observationRepo,
		sessionRepo,
		summaryRepo,
		embeddingModel,
	);
}

function seedObs(
	sessionId: string,
	type: ObservationType,
	title: string,
	overrides?: Partial<Omit<Observation, "id" | "createdAt">>,
): Observation {
	return observationRepo.create({
		sessionId,
		type,
		title,
		subtitle: "",
		facts: [],
		narrative: "n",
		concepts: [],
		filesRead: [],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 10,
		discoveryTokens: 0,
		importance: 3,
		...overrides,
	});
}

function mockCompressorReturning(type: string, title: string, narrative: string) {
	(compressor as unknown as Record<string, unknown>)._generate = () =>
		Promise.resolve({
			text: `<observation>
  <type>${type}</type><title>${title}</title>
  <subtitle>sub</subtitle><facts><fact>f1</fact></facts>
  <narrative>${narrative}</narrative><concepts><concept>c1</concept></concepts>
  <files_read><file>a.ts</file></files_read><files_modified></files_modified>
</observation>`,
		});
}

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	pendingRepo = new PendingMessageRepository(db);
	observationRepo = new ObservationRepository(db);
	sessionRepo = new SessionRepository(db);
	summaryRepo = new SummaryRepository(db);
	compressor = new ObservationCompressor({
		provider: "anthropic",
		apiKey: "test",
		model: "claude-sonnet-4-20250514",
		maxTokensPerCompression: 1024,
		compressionEnabled: true,
		minOutputLength: 10,
		rateLimitingEnabled: false,
	});
	summarizer = new SessionSummarizer({
		provider: "anthropic",
		apiKey: "test",
		model: "claude-sonnet-4-20250514",
		maxTokensPerCompression: 1024,
		compressionEnabled: false,
		rateLimitingEnabled: false,
	});
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

describe("Embedding-Based Deduplication", () => {
	test("skips near-identical observation (same type, similarity >= 0.92)", async () => {
		const embedding = normalize([1, 0, 0, 0.1]);
		const processor = buildProcessor(createMockEmbeddingModel(embedding));

		sessionRepo.create("sess-1", "/tmp/dedup-proj");

		const existing = seedObs("sess-1", "discovery", "Existing observation");
		observationRepo.setEmbedding(existing.id, embedding);

		mockCompressorReturning("discovery", "Nearly identical observation", "Same content");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(0);
		expect(observationRepo.getCount("sess-1")).toBe(1);
	});

	test("stores both observations when types differ (even with high similarity)", async () => {
		const embedding = normalize([1, 0, 0, 0.1]);
		const processor = buildProcessor(createMockEmbeddingModel(embedding));

		sessionRepo.create("sess-1", "/tmp/dedup-proj");

		const existing = seedObs("sess-1", "decision", "Existing decision");
		observationRepo.setEmbedding(existing.id, embedding);

		mockCompressorReturning("discovery", "New discovery", "Some discovery narrative");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(1);
		expect(observationRepo.getCount("sess-1")).toBe(2);
	});

	test("stores both observations when similarity is below threshold", async () => {
		const existingEmbedding = normalize([1, 0, 0, 0]);
		const newEmbedding = normalize([0, 1, 0, 0]);
		const processor = buildProcessor(createMockEmbeddingModel(newEmbedding));

		sessionRepo.create("sess-1", "/tmp/dedup-proj");

		const existing = seedObs("sess-1", "discovery", "First discovery");
		observationRepo.setEmbedding(existing.id, existingEmbedding);

		mockCompressorReturning("discovery", "Second discovery", "A discovery about topic B");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "y".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(1);
		expect(observationRepo.getCount("sess-1")).toBe(2);
	});

	test("stores observation normally when no embedding model available", async () => {
		const processor = buildProcessor(null);

		sessionRepo.create("sess-1", "/tmp/dedup-proj");
		mockCompressorReturning("discovery", "New observation", "narrative");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(1);
		expect(observationRepo.getCount("sess-1")).toBe(1);
	});

	test("stores observation normally when embedding generation fails (graceful degradation)", async () => {
		const processor = buildProcessor(createFailingEmbeddingModel());

		sessionRepo.create("sess-1", "/tmp/dedup-proj");

		const existing = seedObs("sess-1", "discovery", "Existing");
		observationRepo.setEmbedding(existing.id, normalize([1, 0, 0, 0]));

		mockCompressorReturning("discovery", "New observation", "narrative");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(1);
		expect(observationRepo.getCount("sess-1")).toBe(2);
	});
});

describe("ObservationRepository.findSimilar", () => {
	test("returns observations above similarity threshold", () => {
		sessionRepo.create("sess-1", "/tmp/proj");
		const emb = normalize([1, 0, 0, 0]);

		const obs = seedObs("sess-1", "discovery", "Test obs");
		observationRepo.setEmbedding(obs.id, emb);

		const results = observationRepo.findSimilar(emb, "discovery", 0.92, 10);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(obs.id);
		expect(results[0].similarity).toBeGreaterThanOrEqual(0.92);
	});

	test("filters by observation type", () => {
		sessionRepo.create("sess-1", "/tmp/proj");
		const emb = normalize([1, 0, 0, 0]);

		const obs1 = seedObs("sess-1", "discovery", "Discovery");
		observationRepo.setEmbedding(obs1.id, emb);

		const obs2 = seedObs("sess-1", "bugfix", "Bugfix");
		observationRepo.setEmbedding(obs2.id, emb);

		const results = observationRepo.findSimilar(emb, "bugfix", 0.92, 10);
		expect(results.length).toBe(1);
		expect(results[0].id).toBe(obs2.id);
	});

	test("excludes observations below threshold", () => {
		sessionRepo.create("sess-1", "/tmp/proj");
		const emb1 = normalize([1, 0, 0, 0]);
		const emb2 = normalize([0, 1, 0, 0]);

		const obs = seedObs("sess-1", "discovery", "Far away");
		observationRepo.setEmbedding(obs.id, emb2);

		const results = observationRepo.findSimilar(emb1, "discovery", 0.92, 10);
		expect(results.length).toBe(0);
	});

	test("returns empty when no observations with embeddings exist", () => {
		const emb = normalize([1, 0, 0, 0]);
		const results = observationRepo.findSimilar(emb, "discovery", 0.92, 10);
		expect(results.length).toBe(0);
	});

	test("sorts by similarity descending", () => {
		sessionRepo.create("sess-1", "/tmp/proj");
		const queryEmb = normalize([1, 0, 0, 0]);

		const obs1 = seedObs("sess-1", "discovery", "Very similar");
		observationRepo.setEmbedding(obs1.id, normalize([1, 0, 0, 0.1]));

		const obs2 = seedObs("sess-1", "discovery", "Exact match");
		observationRepo.setEmbedding(obs2.id, queryEmb);

		const results = observationRepo.findSimilar(queryEmb, "discovery", 0.9, 10);
		expect(results.length).toBe(2);
		expect(results[0].id).toBe(obs2.id);
		expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
	});

	test("respects limit parameter", () => {
		sessionRepo.create("sess-1", "/tmp/proj");
		const emb = normalize([1, 0, 0, 0]);

		for (let i = 0; i < 3; i++) {
			const obs = seedObs("sess-1", "discovery", `Obs ${i}`);
			observationRepo.setEmbedding(obs.id, emb);
		}

		const results = observationRepo.findSimilar(emb, "discovery", 0.92, 1);
		expect(results.length).toBe(1);
	});
});
