import { afterEach, describe, expect, test } from "bun:test";
import { type MemoryEventBus, type MemoryEventMap, createEventBus } from "../../src/events/bus";
import type { Observation, Session, SessionSummary } from "../../src/types";

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

describe("MemoryEventBus", () => {
	let bus: MemoryEventBus;

	afterEach(() => {
		bus?.removeAllListeners();
	});

	// -------------------------------------------------------------------------
	// createEventBus
	// -------------------------------------------------------------------------

	test("createEventBus returns an event bus", () => {
		bus = createEventBus();
		expect(bus).toBeDefined();
		expect(typeof bus.on).toBe("function");
		expect(typeof bus.off).toBe("function");
		expect(typeof bus.emit).toBe("function");
		expect(typeof bus.once).toBe("function");
		expect(typeof bus.removeAllListeners).toBe("function");
		expect(typeof bus.listenerCount).toBe("function");
	});

	// -------------------------------------------------------------------------
	// emit and receive
	// -------------------------------------------------------------------------

	test("observation:created event delivers payload to listener", () => {
		bus = createEventBus();
		const obs = makeObservation();
		let received: Observation | undefined;

		bus.on("observation:created", (payload) => {
			received = payload;
		});
		bus.emit("observation:created", obs);

		expect(received).toEqual(obs);
	});

	test("observation:updated event delivers payload to listener", () => {
		bus = createEventBus();
		const obs = makeObservation({ title: "Updated" });
		let received: Observation | undefined;

		bus.on("observation:updated", (payload) => {
			received = payload;
		});
		bus.emit("observation:updated", obs);

		expect(received).toEqual(obs);
	});

	test("session:started event delivers Session payload", () => {
		bus = createEventBus();
		const session = makeSession();
		let received: Session | undefined;

		bus.on("session:started", (payload) => {
			received = payload;
		});
		bus.emit("session:started", session);

		expect(received).toEqual(session);
	});

	test("session:ended event delivers Session payload", () => {
		bus = createEventBus();
		const session = makeSession({ status: "completed", endedAt: new Date().toISOString() });
		let received: Session | undefined;

		bus.on("session:ended", (payload) => {
			received = payload;
		});
		bus.emit("session:ended", session);

		expect(received).toEqual(session);
	});

	test("summary:created event delivers SessionSummary payload", () => {
		bus = createEventBus();
		const summary = makeSummary();
		let received: SessionSummary | undefined;

		bus.on("summary:created", (payload) => {
			received = payload;
		});
		bus.emit("summary:created", summary);

		expect(received).toEqual(summary);
	});

	test("pending:enqueued event delivers number payload", () => {
		bus = createEventBus();
		let received: number | undefined;

		bus.on("pending:enqueued", (payload) => {
			received = payload;
		});
		bus.emit("pending:enqueued", 5);

		expect(received).toBe(5);
	});

	test("pending:processed event delivers number payload", () => {
		bus = createEventBus();
		let received: number | undefined;

		bus.on("pending:processed", (payload) => {
			received = payload;
		});
		bus.emit("pending:processed", 3);

		expect(received).toBe(3);
	});

	// -------------------------------------------------------------------------
	// multiple listeners
	// -------------------------------------------------------------------------

	test("multiple listeners receive the same event", () => {
		bus = createEventBus();
		const obs = makeObservation();
		const results: Observation[] = [];

		bus.on("observation:created", (payload) => results.push(payload));
		bus.on("observation:created", (payload) => results.push(payload));
		bus.on("observation:created", (payload) => results.push(payload));

		bus.emit("observation:created", obs);

		expect(results).toHaveLength(3);
		expect(results[0]).toEqual(obs);
		expect(results[1]).toEqual(obs);
		expect(results[2]).toEqual(obs);
	});

	// -------------------------------------------------------------------------
	// once
	// -------------------------------------------------------------------------

	test("once listener fires only on first emit", () => {
		bus = createEventBus();
		let callCount = 0;

		bus.once("pending:enqueued", () => {
			callCount++;
		});

		bus.emit("pending:enqueued", 1);
		bus.emit("pending:enqueued", 2);

		expect(callCount).toBe(1);
	});

	// -------------------------------------------------------------------------
	// off (unsubscribe)
	// -------------------------------------------------------------------------

	test("off removes a specific listener", () => {
		bus = createEventBus();
		let callCount = 0;
		const listener = () => {
			callCount++;
		};

		bus.on("pending:processed", listener);
		bus.emit("pending:processed", 1);
		expect(callCount).toBe(1);

		bus.off("pending:processed", listener);
		bus.emit("pending:processed", 2);
		expect(callCount).toBe(1);
	});

	// -------------------------------------------------------------------------
	// removeAllListeners
	// -------------------------------------------------------------------------

	test("removeAllListeners clears all listeners for a specific event", () => {
		bus = createEventBus();
		let count = 0;

		bus.on("observation:created", () => count++);
		bus.on("observation:created", () => count++);
		bus.removeAllListeners("observation:created");

		bus.emit("observation:created", makeObservation());
		expect(count).toBe(0);
	});

	test("removeAllListeners with no args clears all events", () => {
		bus = createEventBus();
		let obsCount = 0;
		let pendingCount = 0;

		bus.on("observation:created", () => obsCount++);
		bus.on("pending:enqueued", () => pendingCount++);
		bus.removeAllListeners();

		bus.emit("observation:created", makeObservation());
		bus.emit("pending:enqueued", 1);

		expect(obsCount).toBe(0);
		expect(pendingCount).toBe(0);
	});

	// -------------------------------------------------------------------------
	// listenerCount
	// -------------------------------------------------------------------------

	test("listenerCount returns correct count", () => {
		bus = createEventBus();

		expect(bus.listenerCount("observation:created")).toBe(0);

		const l1 = () => {};
		const l2 = () => {};
		bus.on("observation:created", l1);
		bus.on("observation:created", l2);

		expect(bus.listenerCount("observation:created")).toBe(2);

		bus.off("observation:created", l1);
		expect(bus.listenerCount("observation:created")).toBe(1);
	});

	// -------------------------------------------------------------------------
	// event isolation
	// -------------------------------------------------------------------------

	test("events are isolated — emitting one does not trigger another", () => {
		bus = createEventBus();
		let observationFired = false;
		let sessionFired = false;

		bus.on("observation:created", () => {
			observationFired = true;
		});
		bus.on("session:started", () => {
			sessionFired = true;
		});

		bus.emit("observation:created", makeObservation());

		expect(observationFired).toBe(true);
		expect(sessionFired).toBe(false);
	});

	// -------------------------------------------------------------------------
	// independent instances
	// -------------------------------------------------------------------------

	test("separate createEventBus calls return independent instances", () => {
		bus = createEventBus();
		const bus2 = createEventBus();
		let bus1Count = 0;
		let bus2Count = 0;

		bus.on("pending:enqueued", () => bus1Count++);
		bus2.on("pending:enqueued", () => bus2Count++);

		bus.emit("pending:enqueued", 1);

		expect(bus1Count).toBe(1);
		expect(bus2Count).toBe(0);

		bus2.removeAllListeners();
	});
});
