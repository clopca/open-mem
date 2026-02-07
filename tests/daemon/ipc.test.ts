// =============================================================================
// open-mem — IPC Signal Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import { DaemonManager } from "../../src/daemon/manager";
import { DaemonWorker } from "../../src/daemon/worker";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { QueueProcessor } from "../../src/queue/processor";
import { cleanupTestDb, createTestDb } from "../db/helpers";

// -----------------------------------------------------------------------------
// Mock QueueProcessor (for DaemonWorker tests)
// -----------------------------------------------------------------------------

function createMockBatchProcessor(processBatchResult: () => Promise<number> = async () => 0) {
	return {
		processBatch: mock(processBatchResult),
	};
}

// -----------------------------------------------------------------------------
// DaemonWorker IPC Tests
// -----------------------------------------------------------------------------

describe("DaemonWorker IPC signals", () => {
	let worker: DaemonWorker;

	afterEach(() => {
		if (worker) worker.stop();
	});

	test("PROCESS_NOW triggers immediate processBatch", () => {
		const queueProcessor = createMockBatchProcessor(async () => 3);
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 60_000 });

		worker.handleMessage("PROCESS_NOW");

		expect(queueProcessor.processBatch).toHaveBeenCalledTimes(1);
	});

	test("PROCESS_NOW does not crash when processBatch rejects", () => {
		const queueProcessor = createMockBatchProcessor(async () => {
			throw new Error("batch failed");
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 60_000 });

		expect(() => worker.handleMessage("PROCESS_NOW")).not.toThrow();
		expect(queueProcessor.processBatch).toHaveBeenCalledTimes(1);
	});

	test("SHUTDOWN stops the worker", () => {
		const queueProcessor = createMockBatchProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 50 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		worker.handleMessage("SHUTDOWN");
		expect(worker.isRunning).toBe(false);
	});

	test("unknown messages are no-ops", () => {
		const queueProcessor = createMockBatchProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 50 });

		worker.start();
		worker.handleMessage("UNKNOWN_SIGNAL");
		worker.handleMessage(42);
		worker.handleMessage(null);
		worker.handleMessage(undefined);

		expect(worker.isRunning).toBe(true);
		expect(queueProcessor.processBatch).not.toHaveBeenCalled();
	});
});

// -----------------------------------------------------------------------------
// DaemonManager.signal() Tests
// -----------------------------------------------------------------------------

describe("DaemonManager.signal()", () => {
	test("does not throw when subprocess is null (daemon not started)", () => {
		const manager = new DaemonManager({
			dbPath: "/tmp/nonexistent/memory.db",
			projectPath: "/tmp/nonexistent",
			daemonScript: "nonexistent.ts",
		});

		expect(() => manager.signal("PROCESS_NOW")).not.toThrow();
	});

	test("does not throw when subprocess.send fails", () => {
		const manager = new DaemonManager({
			dbPath: "/tmp/nonexistent/memory.db",
			projectPath: "/tmp/nonexistent",
			daemonScript: "nonexistent.ts",
		});

		// Simulate a subprocess with a broken send
		(manager as unknown as Record<string, unknown>).subprocess = {
			send() {
				throw new Error("IPC channel closed");
			},
		};

		expect(() => manager.signal("PROCESS_NOW")).not.toThrow();
	});
});

// -----------------------------------------------------------------------------
// QueueProcessor onEnqueue callback Tests
// -----------------------------------------------------------------------------

describe("QueueProcessor onEnqueue callback", () => {
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

	test("onEnqueue fires on enqueue in enqueue-only mode", () => {
		const processor = buildProcessor();
		const callback = mock(() => {});
		sessionRepo.create("sess-1", "/tmp/proj");

		processor.setMode("enqueue-only");
		processor.setOnEnqueue(callback);
		processor.enqueue("sess-1", "Read", "output data", "call-1");

		expect(callback).toHaveBeenCalledTimes(1);
	});

	test("onEnqueue does NOT fire in in-process mode", () => {
		const processor = buildProcessor();
		const callback = mock(() => {});
		sessionRepo.create("sess-1", "/tmp/proj");

		processor.setMode("in-process");
		processor.setOnEnqueue(callback);
		processor.enqueue("sess-1", "Read", "output data", "call-1");

		expect(callback).not.toHaveBeenCalled();
	});

	test("onEnqueue fires for each enqueue call", () => {
		const processor = buildProcessor();
		const callback = mock(() => {});
		sessionRepo.create("sess-1", "/tmp/proj");

		processor.setMode("enqueue-only");
		processor.setOnEnqueue(callback);
		processor.enqueue("sess-1", "Read", "output 1", "call-1");
		processor.enqueue("sess-1", "Edit", "output 2", "call-2");
		processor.enqueue("sess-1", "Bash", "output 3", "call-3");

		expect(callback).toHaveBeenCalledTimes(3);
	});

	test("setOnEnqueue(null) removes callback", () => {
		const processor = buildProcessor();
		const callback = mock(() => {});
		sessionRepo.create("sess-1", "/tmp/proj");

		processor.setMode("enqueue-only");
		processor.setOnEnqueue(callback);
		processor.enqueue("sess-1", "Read", "output 1", "call-1");
		expect(callback).toHaveBeenCalledTimes(1);

		processor.setOnEnqueue(null);
		processor.enqueue("sess-1", "Read", "output 2", "call-2");
		expect(callback).toHaveBeenCalledTimes(1);
	});

	test("enqueue works without onEnqueue set", () => {
		const processor = buildProcessor();
		sessionRepo.create("sess-1", "/tmp/proj");

		processor.setMode("enqueue-only");
		expect(() => processor.enqueue("sess-1", "Read", "output", "call-1")).not.toThrow();
		expect(pendingRepo.getPending()).toHaveLength(1);
	});
});
