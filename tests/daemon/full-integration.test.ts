// =============================================================================
// open-mem — Daemon Full Integration Tests (End-to-End)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import { readPid, removePid, writePid } from "../../src/daemon/pid";
import { DaemonWorker } from "../../src/daemon/worker";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { QueueProcessor } from "../../src/queue/processor";
import { cleanupTestDb, createTestDb } from "../db/helpers";

// -----------------------------------------------------------------------------
// Shared state
// -----------------------------------------------------------------------------

let db: Database;
let dbPath: string;
let pendingRepo: PendingMessageRepository;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;
let compressor: ObservationCompressor;
let summarizer: SessionSummarizer;

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
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		maxTokensPerCompression: 1024,
		compressionEnabled: true,
		minOutputLength: 10,
		rateLimitingEnabled: false,
	});
	summarizer = new SessionSummarizer({
		provider: "anthropic",
		apiKey: "test-key",
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Inject a mock _generate that returns valid observation XML */
function mockCompressorSuccess() {
	(compressor as unknown as Record<string, unknown>)._generate = () =>
		Promise.resolve({
			text: `<observation>
  <type>discovery</type><title>Integration test observation</title>
  <subtitle>e2e</subtitle><facts><fact>fact-1</fact></facts>
  <narrative>Full integration narrative</narrative><concepts><concept>integration</concept></concepts>
  <files_read><file>src/daemon.ts</file></files_read><files_modified></files_modified>
</observation>`,
		});
}

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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Daemon Full Integration", () => {
	// -------------------------------------------------------------------------
	// E2E: Seed DB → DaemonWorker + QueueProcessor → verify observations
	// -------------------------------------------------------------------------

	test("seed pending messages → DaemonWorker processes → observations created", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();

		const sessionId = `sess-${randomUUID()}`;
		sessionRepo.create(sessionId, "/tmp/test-project");

		pendingRepo.create({
			sessionId,
			toolName: "Read",
			toolOutput: `File content from src/index.ts with important patterns ${"x".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});
		pendingRepo.create({
			sessionId,
			toolName: "Bash",
			toolOutput: `npm test output: 42 tests passed, 0 failed ${"y".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});
		pendingRepo.create({
			sessionId,
			toolName: "Edit",
			toolOutput: `Applied edit to src/config.ts: added new field ${"z".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});

		const pending = pendingRepo.getPending();
		expect(pending).toHaveLength(3);

		const worker = new DaemonWorker({ queueProcessor: processor, pollIntervalMs: 30 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		await sleep(200);

		worker.stop();
		expect(worker.isRunning).toBe(false);

		const observations = observationRepo.getBySession(sessionId);
		expect(observations).toHaveLength(3);

		for (const obs of observations) {
			expect(obs.sessionId).toBe(sessionId);
			expect(obs.title).toBe("Integration test observation");
			expect(obs.type).toBe("discovery");
			expect(obs.narrative).toBe("Full integration narrative");
		}

		const remainingPending = pendingRepo.getPending();
		expect(remainingPending).toHaveLength(0);

		const session = sessionRepo.getById(sessionId);
		expect(session?.observationCount).toBe(3);
	});

	// -------------------------------------------------------------------------
	// E2E: Empty queue — DaemonWorker handles gracefully
	// -------------------------------------------------------------------------

	test("DaemonWorker handles empty queue gracefully — no errors, returns 0", async () => {
		const processor = buildProcessor();

		// No pending messages seeded — queue is empty
		const worker = new DaemonWorker({ queueProcessor: processor, pollIntervalMs: 30 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		// Let it poll several times with empty queue
		await sleep(120);

		worker.stop();
		expect(worker.isRunning).toBe(false);

		// Idle time should have been accumulating (no items processed)
		expect(worker.idleMs).toBeGreaterThan(0);

		// Direct processBatch call should return 0
		const processed = await processor.processBatch();
		expect(processed).toBe(0);
	});

	// -------------------------------------------------------------------------
	// PID file lifecycle: write → read → remove
	// -------------------------------------------------------------------------

	test("PID file lifecycle — writePid → readPid → removePid", () => {
		const pidPath = `/tmp/open-mem-test-${randomUUID()}.pid`;

		try {
			// Write PID
			writePid(pidPath);
			expect(existsSync(pidPath)).toBe(true);

			// Read PID — should match current process
			const pid = readPid(pidPath);
			expect(pid).toBe(process.pid);

			// Remove PID
			removePid(pidPath);
			expect(existsSync(pidPath)).toBe(false);

			// Read after removal — should return null
			const pidAfterRemoval = readPid(pidPath);
			expect(pidAfterRemoval).toBeNull();
		} finally {
			// Cleanup in case test fails mid-way
			removePid(pidPath);
		}
	});

	// -------------------------------------------------------------------------
	// Dual-mode: enqueue-only prevents processing
	// -------------------------------------------------------------------------

	test("dual-mode: enqueue-only prevents processing, in-process enables it", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();

		const sessionId = `sess-${randomUUID()}`;
		sessionRepo.create(sessionId, "/tmp/test-project");

		// 1. Set to enqueue-only mode
		processor.setMode("enqueue-only");
		expect(processor.getMode()).toBe("enqueue-only");

		// 2. Enqueue a message
		processor.enqueue(sessionId, "Read", "x".repeat(100), `call-${randomUUID()}`);

		// 3. processBatch should return 0 (not processed)
		const processed = await processor.processBatch();
		expect(processed).toBe(0);

		// 4. Pending message still exists
		const pending = pendingRepo.getPending(10);
		expect(pending).toHaveLength(1);

		// 5. Switch to in-process mode
		processor.setMode("in-process");
		expect(processor.getMode()).toBe("in-process");

		// 6. Now processBatch should process it
		const processedAfter = await processor.processBatch();
		expect(processedAfter).toBe(1);

		// 7. Observation created
		const observations = observationRepo.getBySession(sessionId);
		expect(observations).toHaveLength(1);
		expect(observations[0].title).toBe("Integration test observation");
	});

	// -------------------------------------------------------------------------
	// E2E: Multiple batches processed across poll cycles
	// -------------------------------------------------------------------------

	test("processes items across multiple poll cycles", async () => {
		mockCompressorSuccess();
		const processor = buildProcessor();

		const sessionId = `sess-${randomUUID()}`;
		sessionRepo.create(sessionId, "/tmp/test-project");

		// Seed first batch
		pendingRepo.create({
			sessionId,
			toolName: "Read",
			toolOutput: `First batch content ${"a".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});

		const worker = new DaemonWorker({ queueProcessor: processor, pollIntervalMs: 30 });
		worker.start();

		// Wait for first batch to process
		await sleep(100);

		// Seed second batch while worker is running
		pendingRepo.create({
			sessionId,
			toolName: "Bash",
			toolOutput: `Second batch content ${"b".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});

		// Wait for second batch to process
		await sleep(150);

		worker.stop();

		// Both items should have been processed
		const observations = observationRepo.getBySession(sessionId);
		expect(observations).toHaveLength(2);

		// Queue should be empty
		const remaining = pendingRepo.getPending();
		expect(remaining).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// E2E: Worker continues after processBatch error
	// -------------------------------------------------------------------------

	test("worker continues processing after transient errors", async () => {
		let callCount = 0;
		// First call fails, subsequent calls succeed
		(compressor as unknown as Record<string, unknown>)._generate = () => {
			callCount++;
			if (callCount === 1) {
				return Promise.reject(new Error("Transient API error"));
			}
			return Promise.resolve({
				text: `<observation>
  <type>change</type><title>Recovery observation</title>
  <subtitle>recovered</subtitle><facts><fact>recovered</fact></facts>
  <narrative>Recovered after error</narrative><concepts><concept>resilience</concept></concepts>
  <files_read></files_read><files_modified><file>src/test.ts</file></files_modified>
</observation>`,
			});
		};

		const processor = buildProcessor();
		const sessionId = `sess-${randomUUID()}`;
		sessionRepo.create(sessionId, "/tmp/test-project");

		// Seed two messages — first will fail AI, second should succeed
		pendingRepo.create({
			sessionId,
			toolName: "Read",
			toolOutput: `Content that triggers error ${"x".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});
		pendingRepo.create({
			sessionId,
			toolName: "Edit",
			toolOutput: `Content that succeeds ${"y".repeat(80)}`,
			callId: `call-${randomUUID()}`,
		});

		const worker = new DaemonWorker({ queueProcessor: processor, pollIntervalMs: 30 });
		worker.start();
		await sleep(300);
		worker.stop();

		// At least some observations should have been created
		// (first item uses fallback on AI failure, second succeeds)
		const observations = observationRepo.getBySession(sessionId);
		expect(observations.length).toBeGreaterThanOrEqual(1);
	});
});
