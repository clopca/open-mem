// =============================================================================
// open-mem — Chat Capture Hook Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { createChatCaptureHook } from "../../src/hooks/chat-capture";

// ---------------------------------------------------------------------------
// Lightweight mocks (matching capture.test.ts pattern)
// ---------------------------------------------------------------------------

function makeMockObservations() {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	return {
		calls,
		create(data: Record<string, unknown>) {
			calls.push({ method: "create", args: [data] });
			return { id: "obs-1", ...data, createdAt: new Date().toISOString() };
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
	};
}

// =============================================================================
// createChatCaptureHook
// =============================================================================

describe("createChatCaptureHook", () => {
	test("captures user messages with string parts", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1" },
			{ message: {}, parts: ["This is a user message that is long enough to capture"] },
		);

		expect(observations.calls.find((c) => c.method === "create")).toBeDefined();
		expect(sessions.calls.find((c) => c.method === "getOrCreate")).toBeDefined();
	});

	test("captures user messages with object-style parts", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1" },
			{
				message: {},
				parts: [{ text: "This is a user message with object parts that is long enough" }],
			},
		);

		const createCall = observations.calls.find((c) => c.method === "create");
		expect(createCall).toBeDefined();
		const data = createCall?.args[0] as Record<string, unknown>;
		expect(data.toolName).toBe("chat.message");
	});

	test("filters out short messages (< 20 chars)", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook({ sessionID: "s1" }, { message: {}, parts: ["short msg"] });

		expect(observations.calls).toHaveLength(0);
	});

	test("filters out assistant messages (agent set to model name)", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1", agent: "claude-sonnet-4-20250514" },
			{
				message: {},
				parts: ["This is an assistant message that is long enough to capture"],
			},
		);

		expect(observations.calls).toHaveLength(0);
	});

	test("allows messages with agent='user'", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1", agent: "user" },
			{
				message: {},
				parts: ["This is a user message that is long enough to capture"],
			},
		);

		expect(observations.calls.find((c) => c.method === "create")).toBeDefined();
	});

	test("truncates title at 60 chars with ellipsis", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		const longMessage = "A".repeat(100);
		await hook({ sessionID: "s1" }, { message: {}, parts: [longMessage] });

		const createCall = observations.calls.find((c) => c.method === "create");
		expect(createCall).toBeDefined();
		const data = createCall?.args[0] as Record<string, unknown>;
		const title = data.title as string;
		expect(title).toContain("User request:");
		// "User request: " + 60 chars + "..."
		expect(title.length).toBeLessThanOrEqual("User request: ".length + 60 + 3);
		expect(title).toContain("...");
	});

	test("does not truncate short titles", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		const shortMessage = "This is exactly a short message";
		await hook({ sessionID: "s1" }, { message: {}, parts: [shortMessage] });

		const createCall = observations.calls.find((c) => c.method === "create");
		const data = createCall?.args[0] as Record<string, unknown>;
		const title = data.title as string;
		expect(title).toBe(`User request: ${shortMessage}`);
		expect(title).not.toContain("...");
	});

	test("truncates narrative at 2000 chars", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		const longMessage = "B".repeat(3000);
		await hook({ sessionID: "s1" }, { message: {}, parts: [longMessage] });

		const createCall = observations.calls.find((c) => c.method === "create");
		const data = createCall?.args[0] as Record<string, unknown>;
		const narrative = data.narrative as string;
		expect(narrative.length).toBeLessThanOrEqual(2003); // 2000 + "..."
		expect(narrative).toContain("...");
	});

	test("extracts concepts (words > 4 chars, max 5)", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1" },
			{
				message: {},
				parts: [
					"Please refactor the authentication module using typescript patterns and implement caching",
				],
			},
		);

		const createCall = observations.calls.find((c) => c.method === "create");
		const data = createCall?.args[0] as Record<string, unknown>;
		const concepts = data.concepts as string[];
		expect(concepts.length).toBeLessThanOrEqual(5);
		expect(concepts.length).toBeGreaterThan(0);
		// All concepts should be > 4 chars
		for (const c of concepts) {
			expect(c.length).toBeGreaterThan(4);
		}
	});

	test("never throws on error", async () => {
		const throwingObservations = {
			create: () => {
				throw new Error("DB broken");
			},
		};
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(
			throwingObservations as never,
			sessions as never,
			"/tmp/proj",
		);

		// Should not throw
		await hook(
			{ sessionID: "s1" },
			{
				message: {},
				parts: ["This is a user message that is long enough to capture"],
			},
		);
	});

	test("sets correct observation fields", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1" },
			{
				message: {},
				parts: ["This is a user message that is long enough to capture"],
			},
		);

		const createCall = observations.calls.find((c) => c.method === "create");
		const data = createCall?.args[0] as Record<string, unknown>;
		expect(data.sessionId).toBe("s1");
		expect(data.type).toBe("discovery");
		expect(data.toolName).toBe("chat.message");
		expect(data.subtitle).toBe("");
		expect(data.discoveryTokens).toBe(0);
		expect((data.filesRead as string[]).length).toBe(0);
		expect((data.filesModified as string[]).length).toBe(0);
	});

	test("handles mixed string and object parts", async () => {
		const observations = makeMockObservations();
		const sessions = makeMockSessions();
		const hook = createChatCaptureHook(observations as never, sessions as never, "/tmp/proj");

		await hook(
			{ sessionID: "s1" },
			{
				message: {},
				parts: ["First part of the message", { text: " and second part of the message" }],
			},
		);

		const createCall = observations.calls.find((c) => c.method === "create");
		expect(createCall).toBeDefined();
		const data = createCall?.args[0] as Record<string, unknown>;
		const narrative = data.narrative as string;
		expect(narrative).toContain("First part");
		expect(narrative).toContain("second part");
	});
});
