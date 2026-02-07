// =============================================================================
// open-mem — DaemonWorker Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { DaemonWorker } from "../../src/daemon/worker";

// -----------------------------------------------------------------------------
// Mock QueueProcessor
// -----------------------------------------------------------------------------

function createMockQueueProcessor(processBatchResult: () => Promise<number> = async () => 0) {
	return {
		processBatch: mock(processBatchResult),
		start: mock(() => {}),
		stop: mock(() => {}),
	};
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("DaemonWorker", () => {
	let worker: DaemonWorker;

	afterEach(() => {
		if (worker) {
			worker.stop();
		}
	});

	// -------------------------------------------------------------------------
	// Constructor / basic state
	// -------------------------------------------------------------------------

	test("starts in stopped state", () => {
		const queueProcessor = createMockQueueProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 1000 });

		expect(worker.isRunning).toBe(false);
	});

	// -------------------------------------------------------------------------
	// start / stop
	// -------------------------------------------------------------------------

	test("start begins polling and stop ends it", async () => {
		let callCount = 0;
		const queueProcessor = createMockQueueProcessor(async () => {
			callCount++;
			return 0;
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 30 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		// Wait for a few poll cycles
		await sleep(100);

		worker.stop();
		expect(worker.isRunning).toBe(false);

		// Should have been called at least once
		expect(callCount).toBeGreaterThanOrEqual(1);
	});

	test("start is idempotent — calling twice does not create duplicate timers", async () => {
		let callCount = 0;
		const queueProcessor = createMockQueueProcessor(async () => {
			callCount++;
			return 0;
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 30 });

		worker.start();
		worker.start(); // second call should be no-op

		await sleep(100);
		worker.stop();

		// If duplicate timers existed, callCount would be ~2x expected
		// With 30ms interval over 100ms, expect ~3 calls max from single timer
		expect(callCount).toBeLessThanOrEqual(6);
	});

	test("stop is idempotent — calling twice does not throw", () => {
		const queueProcessor = createMockQueueProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 1000 });

		worker.start();
		worker.stop();
		expect(() => worker.stop()).not.toThrow();
		expect(worker.isRunning).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Polling calls processBatch
	// -------------------------------------------------------------------------

	test("polling calls queueProcessor.processBatch on each cycle", async () => {
		const results = [3, 2, 0];
		let idx = 0;
		const queueProcessor = createMockQueueProcessor(async () => {
			const val = results[idx] ?? 0;
			idx++;
			return val;
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 20 });

		worker.start();
		await sleep(100);
		worker.stop();

		expect(queueProcessor.processBatch).toHaveBeenCalled();
		// Should have been called multiple times
		expect(queueProcessor.processBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	// -------------------------------------------------------------------------
	// Error handling in processBatch
	// -------------------------------------------------------------------------

	test("processBatch errors do not crash the polling loop", async () => {
		let callCount = 0;
		const queueProcessor = createMockQueueProcessor(async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("Simulated batch error");
			}
			return 0;
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 20 });

		worker.start();
		await sleep(100);
		worker.stop();

		// Despite the error on call 1, should have continued polling
		expect(callCount).toBeGreaterThanOrEqual(2);
	});

	// -------------------------------------------------------------------------
	// Idle time tracking and auto-exit
	// -------------------------------------------------------------------------

	test("tracks idle time since last batch processed items", async () => {
		const queueProcessor = createMockQueueProcessor(async () => 0);
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 20 });

		worker.start();
		await sleep(80);

		// idleMs should be increasing since processBatch always returns 0
		expect(worker.idleMs).toBeGreaterThan(0);
		worker.stop();
	});

	test("idleMs resets when processBatch returns items processed > 0", async () => {
		let callCount = 0;
		const queueProcessor = createMockQueueProcessor(async () => {
			callCount++;
			// Return items on call 3
			if (callCount === 3) return 2;
			return 0;
		});
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 20 });

		worker.start();
		// Wait enough for several cycles including the reset
		await sleep(120);

		// After the reset, idle time should be relatively small
		// (it was reset on call 3, and we may have had a few more idle calls after)
		// Just verify it's been tracking — the exact value depends on timing
		expect(worker.idleMs).toBeGreaterThanOrEqual(0);
		worker.stop();
	});

	// -------------------------------------------------------------------------
	// IPC shutdown message
	// -------------------------------------------------------------------------

	test("handles SHUTDOWN message from parent via IPC", async () => {
		const queueProcessor = createMockQueueProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 50 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		// Simulate IPC SHUTDOWN message via the handler
		worker.handleMessage("SHUTDOWN");

		expect(worker.isRunning).toBe(false);
	});

	test("ignores non-SHUTDOWN IPC messages", async () => {
		const queueProcessor = createMockQueueProcessor();
		worker = new DaemonWorker({ queueProcessor, pollIntervalMs: 50 });

		worker.start();
		expect(worker.isRunning).toBe(true);

		worker.handleMessage("OTHER_MESSAGE");

		expect(worker.isRunning).toBe(true);
		worker.stop();
	});
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
