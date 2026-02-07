// =============================================================================
// open-mem — SSE Broadcaster Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { type MemoryEventBus, createEventBus } from "../../src/events/bus";
import { SSEBroadcaster, type SSEWriter } from "../../src/servers/sse-broadcaster";
import type { Observation, Session, SessionSummary } from "../../src/types";

// -----------------------------------------------------------------------------
// Test Helpers
// -----------------------------------------------------------------------------

const makeObservation = (overrides: Partial<Observation> = {}): Observation => ({
	id: "obs-1",
	sessionId: "ses-1",
	type: "discovery",
	title: "Test observation",
	subtitle: "subtitle",
	facts: ["fact1"],
	narrative: "narrative",
	concepts: ["concept1"],
	filesRead: [],
	filesModified: [],
	rawToolOutput: "raw",
	toolName: "test",
	createdAt: new Date().toISOString(),
	tokenCount: 100,
	discoveryTokens: 200,
	...overrides,
});

const makeSession = (overrides: Partial<Session> = {}): Session => ({
	id: "ses-1",
	projectPath: "/test",
	startedAt: new Date().toISOString(),
	endedAt: null,
	status: "active",
	observationCount: 0,
	summaryId: null,
	...overrides,
});

const makeSummary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
	id: "sum-1",
	sessionId: "ses-1",
	summary: "Test summary",
	keyDecisions: [],
	filesModified: [],
	concepts: [],
	createdAt: new Date().toISOString(),
	tokenCount: 50,
	...overrides,
});

interface ReceivedEvent {
	event: string;
	data: string;
}

function createMockWriter(): { writer: SSEWriter; received: ReceivedEvent[] } {
	const received: ReceivedEvent[] = [];
	const writer: SSEWriter = (event: string, data: string) => {
		received.push({ event, data });
	};
	return { writer, received };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("SSEBroadcaster", () => {
	let bus: MemoryEventBus;
	let broadcaster: SSEBroadcaster;

	afterEach(() => {
		broadcaster?.destroy();
		bus?.removeAllListeners();
	});

	// -------------------------------------------------------------------------
	// addClient / removeClient
	// -------------------------------------------------------------------------

	test("addClient increases clientCount", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		expect(broadcaster.clientCount).toBe(0);

		const { writer } = createMockWriter();
		broadcaster.addClient(writer);

		expect(broadcaster.clientCount).toBe(1);
	});

	test("removeClient decreases clientCount", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer } = createMockWriter();
		broadcaster.addClient(writer);
		expect(broadcaster.clientCount).toBe(1);

		broadcaster.removeClient(writer);
		expect(broadcaster.clientCount).toBe(0);
	});

	test("removing a non-existent client is a no-op", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer } = createMockWriter();
		broadcaster.removeClient(writer);

		expect(broadcaster.clientCount).toBe(0);
	});

	test("multiple clients can be added", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const c1 = createMockWriter();
		const c2 = createMockWriter();
		const c3 = createMockWriter();

		broadcaster.addClient(c1.writer);
		broadcaster.addClient(c2.writer);
		broadcaster.addClient(c3.writer);

		expect(broadcaster.clientCount).toBe(3);
	});

	// -------------------------------------------------------------------------
	// Broadcasting events from bus to clients
	// -------------------------------------------------------------------------

	test("observation:created is broadcast to all clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const c1 = createMockWriter();
		const c2 = createMockWriter();
		broadcaster.addClient(c1.writer);
		broadcaster.addClient(c2.writer);

		const obs = makeObservation();
		bus.emit("observation:created", obs);

		expect(c1.received).toHaveLength(1);
		expect(c1.received[0].event).toBe("observation:created");
		expect(JSON.parse(c1.received[0].data)).toEqual(obs);

		expect(c2.received).toHaveLength(1);
		expect(c2.received[0].event).toBe("observation:created");
	});

	test("observation:updated is broadcast to all clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		const obs = makeObservation({ title: "Updated" });
		bus.emit("observation:updated", obs);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("observation:updated");
		expect(JSON.parse(received[0].data)).toEqual(obs);
	});

	test("session:started is broadcast to clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		const session = makeSession();
		bus.emit("session:started", session);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("session:started");
		expect(JSON.parse(received[0].data)).toEqual(session);
	});

	test("session:ended is broadcast to clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		const session = makeSession({ status: "completed", endedAt: new Date().toISOString() });
		bus.emit("session:ended", session);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("session:ended");
	});

	test("summary:created is broadcast to clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		const summary = makeSummary();
		bus.emit("summary:created", summary);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("summary:created");
		expect(JSON.parse(received[0].data)).toEqual(summary);
	});

	test("pending:enqueued is broadcast to clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		bus.emit("pending:enqueued", 5);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("pending:enqueued");
		expect(JSON.parse(received[0].data)).toBe(5);
	});

	test("pending:processed is broadcast to clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		bus.emit("pending:processed", 3);

		expect(received).toHaveLength(1);
		expect(received[0].event).toBe("pending:processed");
		expect(JSON.parse(received[0].data)).toBe(3);
	});

	test("multiple events accumulate on the same client", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		bus.emit("observation:created", makeObservation());
		bus.emit("session:started", makeSession());
		bus.emit("pending:enqueued", 1);

		expect(received).toHaveLength(3);
		expect(received[0].event).toBe("observation:created");
		expect(received[1].event).toBe("session:started");
		expect(received[2].event).toBe("pending:enqueued");
	});

	test("removed client does not receive further events", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		bus.emit("observation:created", makeObservation());
		expect(received).toHaveLength(1);

		broadcaster.removeClient(writer);
		bus.emit("observation:created", makeObservation());

		expect(received).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// Failed writes cause client removal
	// -------------------------------------------------------------------------

	test("client that throws on write is automatically removed", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const brokenWriter: SSEWriter = () => {
			throw new Error("connection reset");
		};
		const { writer: goodWriter, received } = createMockWriter();

		broadcaster.addClient(brokenWriter);
		broadcaster.addClient(goodWriter);
		expect(broadcaster.clientCount).toBe(2);

		bus.emit("observation:created", makeObservation());

		expect(broadcaster.clientCount).toBe(1);
		expect(received).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// destroy
	// -------------------------------------------------------------------------

	test("destroy removes all clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		broadcaster.addClient(createMockWriter().writer);
		broadcaster.addClient(createMockWriter().writer);
		broadcaster.addClient(createMockWriter().writer);
		expect(broadcaster.clientCount).toBe(3);

		broadcaster.destroy();
		expect(broadcaster.clientCount).toBe(0);
	});

	test("destroy unsubscribes from all event bus events", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		expect(bus.listenerCount("observation:created")).toBe(1);
		expect(bus.listenerCount("observation:updated")).toBe(1);
		expect(bus.listenerCount("session:started")).toBe(1);
		expect(bus.listenerCount("session:ended")).toBe(1);
		expect(bus.listenerCount("summary:created")).toBe(1);
		expect(bus.listenerCount("pending:enqueued")).toBe(1);
		expect(bus.listenerCount("pending:processed")).toBe(1);

		broadcaster.destroy();

		expect(bus.listenerCount("observation:created")).toBe(0);
		expect(bus.listenerCount("observation:updated")).toBe(0);
		expect(bus.listenerCount("session:started")).toBe(0);
		expect(bus.listenerCount("session:ended")).toBe(0);
		expect(bus.listenerCount("summary:created")).toBe(0);
		expect(bus.listenerCount("pending:enqueued")).toBe(0);
		expect(bus.listenerCount("pending:processed")).toBe(0);
	});

	test("events after destroy are not broadcast to previously-connected clients", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		bus.emit("observation:created", makeObservation());
		expect(received).toHaveLength(1);

		broadcaster.destroy();

		bus.emit("observation:created", makeObservation());
		expect(received).toHaveLength(1);
	});

	test("destroy is idempotent", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		broadcaster.addClient(createMockWriter().writer);

		broadcaster.destroy();
		broadcaster.destroy();

		expect(broadcaster.clientCount).toBe(0);
	});

	// -------------------------------------------------------------------------
	// Data format
	// -------------------------------------------------------------------------

	test("broadcast data is JSON-stringified", () => {
		bus = createEventBus();
		broadcaster = new SSEBroadcaster(bus);

		const { writer, received } = createMockWriter();
		broadcaster.addClient(writer);

		const obs = makeObservation({ title: "JSON test", id: "obs-json" });
		bus.emit("observation:created", obs);

		const parsed = JSON.parse(received[0].data);
		expect(parsed.id).toBe("obs-json");
		expect(parsed.title).toBe("JSON test");
	});
});
