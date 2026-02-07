// =============================================================================
// open-mem — Queue Processor Dual-Mode Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { type ProcessingMode, QueueProcessor } from "../../src/queue/processor";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let pendingRepo: PendingMessageRepository;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;
let compressor: ObservationCompressor;
let summarizer: SessionSummarizer;

function buildProcessor() {
	return new QueueProcessor(
		{ batchSize: 10, batchIntervalMs: 60_000 },
		compressor,
		summarizer,
		pendingRepo,
		observationRepo,
		sessionRepo,
		summaryRepo,
	);
}

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

describe("QueueProcessor dual-mode", () => {
	// -------------------------------------------------------------------------
	// Default mode
	// -------------------------------------------------------------------------

	test("default mode is 'in-process'", () => {
		const processor = buildProcessor();
		expect(processor.getMode()).toBe("in-process");
	});

	test("setMode changes mode", () => {
		const processor = buildProcessor();
		processor.setMode("enqueue-only");
		expect(processor.getMode()).toBe("enqueue-only");
		processor.setMode("in-process");
		expect(processor.getMode()).toBe("in-process");
	});

	// -------------------------------------------------------------------------
	// enqueue-only mode: start() is no-op
	// -------------------------------------------------------------------------

	test("start() is no-op in enqueue-only mode", () => {
		const processor = buildProcessor();
		processor.setMode("enqueue-only");
		processor.start();
		expect(processor.isRunning).toBe(false);
	});

	// -------------------------------------------------------------------------
	// enqueue-only mode: processBatch() returns 0
	// -------------------------------------------------------------------------

	test("processBatch() returns 0 in enqueue-only mode", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		processor.setMode("enqueue-only");
		const result = await processor.processBatch();
		expect(result).toBe(0);
		expect(pendingRepo.getPending()).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// enqueue-only mode: enqueue() still works
	// -------------------------------------------------------------------------

	test("enqueue() works in enqueue-only mode", () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		processor.setMode("enqueue-only");
		processor.enqueue("sess-1", "Read", "output", "call-1");
		expect(pendingRepo.getPending()).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// enqueue-only mode: summarizeSession() still works
	// -------------------------------------------------------------------------

	test("summarizeSession() works in enqueue-only mode", async () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
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
			discoveryTokens: 100,
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
			discoveryTokens: 100,
		});

		processor.setMode("enqueue-only");
		await processor.summarizeSession("sess-1");
		const summary = summaryRepo.getBySessionId("sess-1");
		expect(summary).not.toBeNull();
	});

	// -------------------------------------------------------------------------
	// Mode switching: enqueue-only -> in-process
	// -------------------------------------------------------------------------

	test("switching to in-process allows start() to work", () => {
		const processor = buildProcessor();
		processor.setMode("enqueue-only");
		processor.start();
		expect(processor.isRunning).toBe(false);

		processor.setMode("in-process");
		processor.start();
		expect(processor.isRunning).toBe(true);
		processor.stop();
	});

	test("switching to in-process allows processBatch()", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");
		pendingRepo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "x".repeat(100),
			callId: "c1",
		});

		processor.setMode("enqueue-only");
		const result1 = await processor.processBatch();
		expect(result1).toBe(0);

		processor.setMode("in-process");
		const result2 = await processor.processBatch();
		expect(result2).toBe(1);
	});

	// -------------------------------------------------------------------------
	// Mode switching: stops timer when switching to enqueue-only
	// -------------------------------------------------------------------------

	test("switching to enqueue-only stops running timer", () => {
		const processor = buildProcessor();
		processor.start();
		expect(processor.isRunning).toBe(true);

		processor.setMode("enqueue-only");
		expect(processor.isRunning).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Type export
	// -------------------------------------------------------------------------

	test("ProcessingMode type is usable", () => {
		const mode: ProcessingMode = "enqueue-only";
		expect(mode).toBe("enqueue-only");
		const mode2: ProcessingMode = "in-process";
		expect(mode2).toBe("in-process");
	});
});
