// =============================================================================
// open-mem — Session Event Non-Blocking Behavior Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import { createEventHandler } from "../../src/hooks/session-events";
import type { OpenMemConfig } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
	return { ...getDefaultConfig(), ...overrides };
}

function makeMockSessions() {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	return {
		calls,
		getOrCreate(sessionId: string, projectPath: string) {
			calls.push({ method: "getOrCreate", args: [sessionId, projectPath] });
			return { id: sessionId, projectPath, status: "active" };
		},
		updateStatus(id: string, status: string) {
			calls.push({ method: "updateStatus", args: [id, status] });
		},
		markCompleted(id: string) {
			calls.push({ method: "markCompleted", args: [id] });
		},
	};
}

function makeMockObs() {
	return { getBySession: () => [], deleteOlderThan: () => 0 };
}

function makeMockPending() {
	return { deleteCompletedOlderThan: () => 0 };
}

function makeGate() {
	let resolve = () => {};
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, open: resolve };
}

// ---------------------------------------------------------------------------
// Non-blocking session.idle tests
// ---------------------------------------------------------------------------

describe("session.idle non-blocking behavior", () => {
	const originalError = console.error;

	afterEach(() => {
		console.error = originalError;
	});

	test("session.idle returns immediately without awaiting processBatch", async () => {
		let processBatchResolved = false;
		const gate = makeGate();

		const queue = {
			async processBatch() {
				await gate.promise;
				processBatchResolved = true;
				return 0;
			},
			async summarizeSession() {},
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: false }),
			makeMockObs() as never,
			makeMockPending() as never,
		);

		await handler({
			event: { type: "session.idle", properties: { sessionID: "s1" } },
		});

		expect(processBatchResolved).toBe(false);

		gate.open();
		await gate.promise;
	});

	test("session.completed still awaits processBatch (blocking)", async () => {
		let processBatchResolved = false;
		const gate = makeGate();

		const queue = {
			async processBatch() {
				await gate.promise;
				processBatchResolved = true;
				return 0;
			},
			async summarizeSession() {},
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: false }),
			makeMockObs() as never,
			makeMockPending() as never,
		);

		setTimeout(() => {
			gate.open();
		}, 10);

		await handler({
			event: { type: "session.completed", properties: { sessionID: "s1" } },
		});

		expect(processBatchResolved).toBe(true);
	});

	test("errors in non-blocking session.idle processBatch are logged, not thrown", async () => {
		const logged: unknown[] = [];
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};

		const queue = {
			async processBatch() {
				throw new Error("batch processing failed");
			},
			async summarizeSession() {},
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: false }),
			makeMockObs() as never,
			makeMockPending() as never,
		);

		// Should NOT throw
		await handler({
			event: { type: "session.idle", properties: { sessionID: "s1" } },
		});

		// Give the fire-and-forget promise time to reject and log
		await new Promise((r) => setTimeout(r, 20));

		// Error should have been logged with [open-mem] prefix
		const errorLog = logged.find(
			(entry) =>
				Array.isArray(entry) && typeof entry[0] === "string" && entry[0].includes("[open-mem]"),
		);
		expect(errorLog).toBeDefined();
	});

	test("errors in non-blocking session.idle triggerFolderContext are logged, not thrown", async () => {
		const logged: unknown[] = [];
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};

		const queue = {
			async processBatch() {
				return 0;
			},
			async summarizeSession() {},
		};

		// Mock observations that will trigger folder context
		const mockObs = {
			getBySession: () => {
				throw new Error("folder context failed");
			},
			deleteOlderThan: () => 0,
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: true }),
			mockObs as never,
			makeMockPending() as never,
		);

		// Should NOT throw
		await handler({
			event: { type: "session.idle", properties: { sessionID: "s1" } },
		});

		// Give the fire-and-forget promise time to reject and log
		await new Promise((r) => setTimeout(r, 20));

		// Error should have been logged
		const errorLog = logged.find(
			(entry) =>
				Array.isArray(entry) && typeof entry[0] === "string" && entry[0].includes("[open-mem]"),
		);
		expect(errorLog).toBeDefined();
	});

	test("session.idle updates status synchronously before returning", async () => {
		const queue = {
			async processBatch() {
				await new Promise((r) => setTimeout(r, 100));
				return 0;
			},
			async summarizeSession() {},
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: false }),
			makeMockObs() as never,
			makeMockPending() as never,
		);

		await handler({
			event: { type: "session.idle", properties: { sessionID: "s1" } },
		});

		expect(sessions.calls.find((c) => c.method === "updateStatus")).toBeDefined();
	});

	test("multiple rapid session.idle events all return immediately", async () => {
		let processBatchCallCount = 0;
		const queue = {
			async processBatch() {
				processBatchCallCount++;
				// Simulate slow processing
				await new Promise((r) => setTimeout(r, 50));
				return 0;
			},
			async summarizeSession() {},
		};

		const sessions = makeMockSessions();
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig({ folderContextEnabled: false }),
			makeMockObs() as never,
			makeMockPending() as never,
		);

		const start = Date.now();

		// Fire 5 rapid idle events
		await Promise.all([
			handler({ event: { type: "session.idle", properties: { sessionID: "s1" } } }),
			handler({ event: { type: "session.idle", properties: { sessionID: "s1" } } }),
			handler({ event: { type: "session.idle", properties: { sessionID: "s1" } } }),
			handler({ event: { type: "session.idle", properties: { sessionID: "s1" } } }),
			handler({ event: { type: "session.idle", properties: { sessionID: "s1" } } }),
		]);

		const elapsed = Date.now() - start;

		// All handlers should return nearly instantly (non-blocking)
		// If they were blocking, 5 * 50ms = 250ms minimum
		expect(elapsed).toBeLessThan(50);

		// processBatch was called 5 times (fire-and-forget, each call starts independently)
		// The processor's internal `this.processing` guard handles concurrency
		expect(processBatchCallCount).toBeGreaterThanOrEqual(1);
	});
});
