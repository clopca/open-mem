// =============================================================================
// open-mem — Tool Capture & Session Event Tests (Task 14)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import { createEventHandler } from "../../src/hooks/session-events";
import { createToolCaptureHook } from "../../src/hooks/tool-capture";
import type { OpenMemConfig } from "../../src/types";

// ---------------------------------------------------------------------------
// Lightweight mocks (no real DB or queue)
// ---------------------------------------------------------------------------

function makeMockQueue() {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	return {
		calls,
		enqueue(sessionId: string, toolName: string, output: string, callId: string) {
			calls.push({ method: "enqueue", args: [sessionId, toolName, output, callId] });
		},
		async processBatch() {
			calls.push({ method: "processBatch", args: [] });
			return 0;
		},
		async summarizeSession(sessionId: string) {
			calls.push({ method: "summarizeSession", args: [sessionId] });
		},
	};
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

function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
	return { ...getDefaultConfig(), minOutputLength: 10, ...overrides };
}

// =============================================================================
// Tool Capture Hook
// =============================================================================

describe("createToolCaptureHook", () => {
	test("captures tool output and enqueues", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{ title: "Read", output: "x".repeat(100), metadata: {} },
		);

		expect(queue.calls.find((c) => c.method === "enqueue")).toBeDefined();
		expect(sessions.calls.find((c) => c.method === "getOrCreate")).toBeDefined();
	});

	test("filters ignored tools", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig({ ignoredTools: ["Bash"] }),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Bash", sessionID: "s1", callID: "c1" },
			{ title: "Bash", output: "x".repeat(100), metadata: {} },
		);

		expect(queue.calls).toHaveLength(0);
	});

	test("filters short output", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig({ minOutputLength: 50 }),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{ title: "Read", output: "short", metadata: {} },
		);

		expect(queue.calls).toHaveLength(0);
	});

	test("redacts sensitive patterns", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig({ sensitivePatterns: ["sk-[a-zA-Z0-9]+"] }),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{
				title: "Read",
				output: "api key is sk-abc123XYZ and more text here to be long enough",
				metadata: {},
			},
		);

		const enqueueCall = queue.calls.find((c) => c.method === "enqueue");
		expect(enqueueCall).toBeDefined();
		const enqueuedOutput = enqueueCall?.args[2] as string;
		expect(enqueuedOutput).toContain("[REDACTED]");
		expect(enqueuedOutput).not.toContain("sk-abc123XYZ");
	});

	test("ensures session exists", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "new-session", callID: "c1" },
			{ title: "Read", output: "x".repeat(100), metadata: {} },
		);

		const call = sessions.calls.find((c) => c.method === "getOrCreate");
		expect(call?.args[0]).toBe("new-session");
	});

	test("strips <private> tags from output", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{
				title: "Read",
				output: "visible <private>secret data</private> more visible",
				metadata: {},
			},
		);

		const enqueueCall = queue.calls.find((c) => c.method === "enqueue");
		expect(enqueueCall).toBeDefined();
		const enqueuedOutput = enqueueCall?.args[2] as string;
		expect(enqueuedOutput).toContain("[PRIVATE]");
		expect(enqueuedOutput).not.toContain("secret data");
		expect(enqueuedOutput).toContain("visible");
		expect(enqueuedOutput).toContain("more visible");
	});

	test("strips multiple <private> tags", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{
				title: "Read",
				output:
					"start <private>first secret</private> middle <private>second secret</private> end padding",
				metadata: {},
			},
		);

		const enqueueCall = queue.calls.find((c) => c.method === "enqueue");
		expect(enqueueCall).toBeDefined();
		const enqueuedOutput = enqueueCall?.args[2] as string;
		expect(enqueuedOutput).toBe("start [PRIVATE] middle [PRIVATE] end padding");
	});

	test("handles multiline private content", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{
				title: "Read",
				output: "before <private>\nline1\nline2\n</private> after padding text",
				metadata: {},
			},
		);

		const enqueueCall = queue.calls.find((c) => c.method === "enqueue");
		expect(enqueueCall).toBeDefined();
		const enqueuedOutput = enqueueCall?.args[2] as string;
		expect(enqueuedOutput).toBe("before [PRIVATE] after padding text");
		expect(enqueuedOutput).not.toContain("line1");
		expect(enqueuedOutput).not.toContain("line2");
	});

	test("preserves output without private tags", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			queue as never,
			sessions as never,
			"/tmp/proj",
		);

		const normalOutput = "this is normal output without any private tags at all";
		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{ title: "Read", output: normalOutput, metadata: {} },
		);

		const enqueueCall = queue.calls.find((c) => c.method === "enqueue");
		expect(enqueueCall).toBeDefined();
		const enqueuedOutput = enqueueCall?.args[2] as string;
		expect(enqueuedOutput).toBe(normalOutput);
	});

	test("never throws on error", async () => {
		const throwingQueue = {
			enqueue: () => {
				throw new Error("queue broken");
			},
		};
		const sessions = makeMockSessions();
		const hook = createToolCaptureHook(
			makeConfig(),
			throwingQueue as never,
			sessions as never,
			"/tmp/proj",
		);

		// Should not throw
		await hook(
			{ tool: "Read", sessionID: "s1", callID: "c1" },
			{ title: "Read", output: "x".repeat(100), metadata: {} },
		);
	});
});

// =============================================================================
// Session Event Handler
// =============================================================================

describe("createEventHandler", () => {
	test("handles session.created", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const mockObs = { getBySession: () => [], deleteOlderThan: () => 0 };
		const mockPending = { deleteCompletedOlderThan: () => 0 };
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig(),
			mockObs as never,
			mockPending as never,
		);

		await handler({
			event: {
				type: "session.created",
				properties: { sessionID: "s1" },
			},
		});

		expect(sessions.calls.find((c) => c.method === "getOrCreate")).toBeDefined();
	});

	test("handles session.idle — triggers processBatch", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const mockObs = { getBySession: () => [], deleteOlderThan: () => 0 };
		const mockPending = { deleteCompletedOlderThan: () => 0 };
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig(),
			mockObs as never,
			mockPending as never,
		);

		await handler({
			event: {
				type: "session.idle",
				properties: { sessionID: "s1" },
			},
		});

		expect(queue.calls.find((c) => c.method === "processBatch")).toBeDefined();
		expect(sessions.calls.find((c) => c.method === "updateStatus")).toBeDefined();
	});

	test("handles session.completed — summarize + markCompleted", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const mockObs = { getBySession: () => [], deleteOlderThan: () => 0 };
		const mockPending = { deleteCompletedOlderThan: () => 0 };
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig(),
			mockObs as never,
			mockPending as never,
		);

		await handler({
			event: {
				type: "session.completed",
				properties: { sessionID: "s1" },
			},
		});

		expect(queue.calls.find((c) => c.method === "processBatch")).toBeDefined();
		expect(queue.calls.find((c) => c.method === "summarizeSession")).toBeDefined();
		expect(sessions.calls.find((c) => c.method === "markCompleted")).toBeDefined();
	});

	test("ignores unknown events", async () => {
		const queue = makeMockQueue();
		const sessions = makeMockSessions();
		const mockObs = { getBySession: () => [], deleteOlderThan: () => 0 };
		const mockPending = { deleteCompletedOlderThan: () => 0 };
		const handler = createEventHandler(
			queue as never,
			sessions as never,
			"/tmp/proj",
			makeConfig(),
			mockObs as never,
			mockPending as never,
		);

		await handler({
			event: { type: "some.unknown.event", properties: {} },
		});

		expect(queue.calls).toHaveLength(0);
		expect(sessions.calls).toHaveLength(0);
	});
});
