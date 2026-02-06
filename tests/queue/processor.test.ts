// =============================================================================
// open-mem — Queue Processor Tests (Task 13)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { QueueProcessor } from "../../src/queue/processor";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let pendingRepo: PendingMessageRepository;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;
let compressor: ObservationCompressor;
let summarizer: SessionSummarizer;

function buildProcessor(configOverrides?: Record<string, unknown>) {
	return new QueueProcessor(
		{ batchSize: 10, batchIntervalMs: 60_000, ...configOverrides },
		compressor,
		summarizer,
		pendingRepo,
		observationRepo,
		sessionRepo,
		summaryRepo,
	);
}

/** Inject a mock _generate that returns valid observation XML */
function mockCompressorSuccess() {
	(compressor as unknown as Record<string, unknown>)._generate = () =>
		Promise.resolve({
			text: `<observation>
  <type>discovery</type><title>Mock observation</title>
  <subtitle>sub</subtitle><facts><fact>f1</fact></facts>
  <narrative>narrative</narrative><concepts><concept>c1</concept></concepts>
  <files_read><file>a.ts</file></files_read><files_modified></files_modified>
</observation>`,
		});
}

function mockCompressorFailure() {
	(compressor as unknown as Record<string, unknown>)._generate = () =>
		Promise.reject(new Error("API down"));
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
		compressionEnabled: false, // use fallback by default
		rateLimitingEnabled: false,
	});
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

describe("QueueProcessor", () => {
	test("processBatch processes pending items", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Bash",
			toolOutput: "y".repeat(100),
			callId: "c2",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(2);
		expect(observationRepo.getCount("sess-1")).toBe(2);
	});

	test("processBatch returns 0 when already processing", async () => {
		const processor = buildProcessor();
		// Force the processing flag on
		(processor as unknown as Record<string, unknown>).processing = true;
		const result = await processor.processBatch();
		expect(result).toBe(0);
	});

	test("processBatch uses fallback on AI failure", async () => {
		mockCompressorFailure();
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		const processed = await processor.processBatch();
		expect(processed).toBe(1);
		const obs = observationRepo.getBySession("sess-1");
		expect(obs).toHaveLength(1);
		expect(obs[0].title).toBe("Read execution"); // fallback title
	});

	test("processBatch marks failed items", async () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});
		// Break the compressor entirely so even fallback fails
		(compressor as unknown as Record<string, unknown>)._generate = () =>
			Promise.reject(new Error("boom"));
		// Also break createFallbackObservation
		compressor.createFallbackObservation = () => {
			throw new Error("fallback broken");
		};

		const processed = await processor.processBatch();
		expect(processed).toBe(0);
		const failed = pendingRepo.getByStatus("failed");
		expect(failed).toHaveLength(1);
		expect(failed[0].error).toContain("fallback broken");
	});

	test("processBatch increments session observation count", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		await processor.processBatch();
		const session = sessionRepo.getById("sess-1");
		expect(session?.observationCount).toBe(1);
	});

	test("summarizeSession creates summary", async () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		// Create 2 observations directly (bypass queue)
		observationRepo.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Found auth",
			subtitle: "",
			facts: [],
			narrative: "Found JWT auth",
			concepts: ["JWT"],
			filesRead: ["a.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});
		observationRepo.create({
			sessionId: "sess-1",
			type: "change",
			title: "Updated login",
			subtitle: "",
			facts: [],
			narrative: "Fixed login flow",
			concepts: ["auth"],
			filesRead: [],
			filesModified: ["b.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 50,
		});

		await processor.summarizeSession("sess-1");
		const summary = summaryRepo.getBySessionId("sess-1");
		expect(summary).not.toBeNull();
		expect(summary?.summary).toContain("2 observations");
	});

	test("summarizeSession skips sessions with < 2 observations", async () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		observationRepo.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Solo",
			subtitle: "",
			facts: [],
			narrative: "One observation",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		await processor.summarizeSession("sess-1");
		expect(summaryRepo.getBySessionId("sess-1")).toBeNull();
	});

	test("summarizeSession skips existing summary", async () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		observationRepo.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "A",
			subtitle: "",
			facts: [],
			narrative: "n",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "r",
			toolName: "Read",
			tokenCount: 10,
		});
		observationRepo.create({
			sessionId: "sess-1",
			type: "change",
			title: "B",
			subtitle: "",
			facts: [],
			narrative: "n",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "r",
			toolName: "Edit",
			tokenCount: 10,
		});
		summaryRepo.create({
			sessionId: "sess-1",
			summary: "existing",
			keyDecisions: [],
			filesModified: [],
			concepts: [],
			tokenCount: 10,
		});

		await processor.summarizeSession("sess-1");
		// Should still have just 1 summary
		const recent = summaryRepo.getRecent(10);
		expect(recent).toHaveLength(1);
	});

	test("enqueue creates pending message", () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		processor.enqueue("sess-1", "Read", "output", "call-1");
		expect(pendingRepo.getPending()).toHaveLength(1);
	});

	test("start and stop timer", () => {
		const processor = buildProcessor();
		expect(processor.isRunning).toBe(false);
		processor.start();
		expect(processor.isRunning).toBe(true);
		processor.stop();
		expect(processor.isRunning).toBe(false);
	});
});
