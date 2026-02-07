// =============================================================================
// open-mem — CRUD Operations Tests (Task 07)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { cleanupTestDb, createTestDb } from "./helpers";

let db: Database;
let dbPath: string;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

// =============================================================================
// Session Repository
// =============================================================================

describe("SessionRepository", () => {
	test("create returns a session", () => {
		const repo = new SessionRepository(db);
		const session = repo.create("sess-1", "/tmp/project");
		expect(session.id).toBe("sess-1");
		expect(session.projectPath).toBe("/tmp/project");
		expect(session.status).toBe("active");
		expect(session.observationCount).toBe(0);
		expect(session.endedAt).toBeNull();
		expect(session.summaryId).toBeNull();
	});

	test("getById finds existing session", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		const found = repo.getById("sess-1");
		expect(found).not.toBeNull();
		expect(found?.id).toBe("sess-1");
	});

	test("getById returns null for missing session", () => {
		const repo = new SessionRepository(db);
		expect(repo.getById("nonexistent")).toBeNull();
	});

	test("getOrCreate returns existing session", () => {
		const repo = new SessionRepository(db);
		const original = repo.create("sess-1", "/tmp/project");
		const found = repo.getOrCreate("sess-1", "/tmp/project");
		expect(found.id).toBe(original.id);
		expect(found.startedAt).toBe(original.startedAt);
	});

	test("getOrCreate creates new session", () => {
		const repo = new SessionRepository(db);
		const session = repo.getOrCreate("sess-new", "/tmp/project");
		expect(session.id).toBe("sess-new");
		expect(session.status).toBe("active");
	});

	test("updateStatus changes session status", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		repo.updateStatus("sess-1", "idle");
		const updated = repo.getById("sess-1");
		expect(updated?.status).toBe("idle");
	});

	test("markCompleted sets status and endedAt", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		repo.markCompleted("sess-1");
		const completed = repo.getById("sess-1");
		expect(completed?.status).toBe("completed");
		expect(completed?.endedAt).not.toBeNull();
	});

	test("getRecent returns sessions ordered by started_at DESC", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		repo.create("sess-2", "/tmp/project");
		repo.create("sess-3", "/tmp/other");
		// Set explicit timestamps to make ordering deterministic
		db.run("UPDATE sessions SET started_at = ? WHERE id = ?", [
			"2026-01-01T00:00:00.000Z",
			"sess-1",
		]);
		db.run("UPDATE sessions SET started_at = ? WHERE id = ?", [
			"2026-01-02T00:00:00.000Z",
			"sess-2",
		]);
		const recent = repo.getRecent("/tmp/project", 10);
		expect(recent).toHaveLength(2);
		// Most recent first
		expect(recent[0].id).toBe("sess-2");
		expect(recent[1].id).toBe("sess-1");
	});

	test("incrementObservationCount increases count", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		repo.incrementObservationCount("sess-1");
		repo.incrementObservationCount("sess-1");
		const session = repo.getById("sess-1");
		expect(session?.observationCount).toBe(2);
	});

	test("getActive returns only active sessions", () => {
		const repo = new SessionRepository(db);
		repo.create("sess-1", "/tmp/project");
		repo.create("sess-2", "/tmp/project");
		repo.markCompleted("sess-2");
		const active = repo.getActive();
		expect(active).toHaveLength(1);
		expect(active[0].id).toBe("sess-1");
	});
});

// =============================================================================
// Observation Repository
// =============================================================================

function createSessionAndObs(db: Database) {
	const sessions = new SessionRepository(db);
	const observations = new ObservationRepository(db);
	sessions.create("sess-1", "/tmp/project");
	return { sessions, observations };
}

function makeObservationData(overrides?: Record<string, unknown>) {
	return {
		sessionId: "sess-1",
		type: "discovery" as const,
		title: "Found JWT authentication pattern",
		subtitle: "In the auth module",
		facts: ["Uses JWT tokens", "Tokens expire in 1 hour"],
		narrative: "Discovered that the auth module uses JWT tokens with 1 hour expiry.",
		concepts: ["authentication", "JWT"],
		filesRead: ["src/auth.ts"],
		filesModified: [] as string[],
		rawToolOutput: "cat src/auth.ts output...",
		toolName: "Read",
		tokenCount: 150,
		...overrides,
	};
}

describe("ObservationRepository", () => {
	test("create returns an observation with generated id", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		expect(obs.id).toBeDefined();
		expect(obs.title).toBe("Found JWT authentication pattern");
		expect(obs.facts).toEqual(["Uses JWT tokens", "Tokens expire in 1 hour"]);
		expect(obs.createdAt).toBeDefined();
	});

	test("getBySession returns observations ordered by created_at", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData({ title: "First" }));
		observations.create(makeObservationData({ title: "Second" }));
		observations.create(makeObservationData({ title: "Third" }));
		const results = observations.getBySession("sess-1");
		expect(results).toHaveLength(3);
		expect(results[0].title).toBe("First");
		expect(results[2].title).toBe("Third");
	});

	test("search FTS5 returns matching observations", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData());
		observations.create(
			makeObservationData({
				title: "React component refactoring",
				concepts: ["react", "refactoring"],
				type: "refactor",
			}),
		);

		const results = observations.search({ query: "JWT authentication" });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].observation.title).toContain("JWT");
		expect(results[0].rank).toBeDefined();
	});

	test("search with type filter returns only matching type", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData({ type: "discovery" }));
		observations.create(
			makeObservationData({
				title: "Decided to use JWT",
				type: "decision",
			}),
		);

		const results = observations.search({
			query: "JWT",
			type: "decision",
		});
		expect(results).toHaveLength(1);
		expect(results[0].observation.type).toBe("decision");
	});

	test("getIndex returns lightweight projections", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData());
		const index = observations.getIndex("/tmp/project");
		expect(index).toHaveLength(1);
		expect(index[0].id).toBeDefined();
		expect(index[0].title).toBe("Found JWT authentication pattern");
		expect(index[0].tokenCount).toBe(150);
		// Should NOT have full observation fields
		expect("narrative" in index[0]).toBe(false);
	});

	test("searchByConcept finds observations by concept", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData());
		observations.create(
			makeObservationData({
				title: "Database migration",
				concepts: ["database", "migration"],
			}),
		);
		const results = observations.searchByConcept("authentication");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].concepts).toContain("authentication");
	});

	test("searchByFile finds observations referencing a file", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData());
		observations.create(
			makeObservationData({
				title: "Other file",
				filesRead: ["src/other.ts"],
			}),
		);
		const results = observations.searchByFile("src/auth.ts");
		expect(results.length).toBeGreaterThanOrEqual(1);
	});

	test("getCount returns total and per-session counts", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.create("sess-2", "/tmp/project");
		observations.create(makeObservationData({ sessionId: "sess-1" }));
		observations.create(makeObservationData({ sessionId: "sess-1" }));
		observations.create(makeObservationData({ sessionId: "sess-2" }));

		expect(observations.getCount()).toBe(3);
		expect(observations.getCount("sess-1")).toBe(2);
		expect(observations.getCount("sess-2")).toBe(1);
	});

	test("create stores and retrieves importance", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData({ importance: 5 }));
		const fetched = observations.getById(obs.id);
		expect(fetched?.importance).toBe(5);
	});

	test("importance defaults to 3 when not provided", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		const fetched = observations.getById(obs.id);
		expect(fetched?.importance).toBe(3);
	});

	test("getIndex includes importance field", () => {
		const { observations } = createSessionAndObs(db);
		observations.create(makeObservationData({ importance: 4 }));
		const index = observations.getIndex("/tmp/project");
		expect(index).toHaveLength(1);
		expect(index[0].importance).toBe(4);
	});

	test("importObservation preserves importance", () => {
		const { observations } = createSessionAndObs(db);
		observations.importObservation({
			id: "import-1",
			sessionId: "sess-1",
			type: "discovery",
			title: "Imported obs",
			subtitle: "",
			facts: [],
			narrative: "test",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			createdAt: new Date().toISOString(),
			tokenCount: 100,
			discoveryTokens: 50,
			importance: 5,
		});
		const fetched = observations.getById("import-1");
		expect(fetched?.importance).toBe(5);
	});

	test("JSON round-trip preserves arrays", () => {
		const { observations } = createSessionAndObs(db);
		const data = makeObservationData({
			facts: ["fact1", "fact2", "fact3"],
			concepts: ["c1", "c2"],
			filesRead: ["a.ts", "b.ts"],
			filesModified: ["c.ts"],
		});
		const created = observations.create(data);
		const fetched = observations.getById(created.id);
		expect(fetched?.facts).toEqual(["fact1", "fact2", "fact3"]);
		expect(fetched?.concepts).toEqual(["c1", "c2"]);
		expect(fetched?.filesRead).toEqual(["a.ts", "b.ts"]);
		expect(fetched?.filesModified).toEqual(["c.ts"]);
	});

	// =========================================================================
	// update()
	// =========================================================================

	test("update returns updated observation", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		const updated = observations.update(obs.id, { title: "Updated title" });
		expect(updated).not.toBeNull();
		expect(updated?.title).toBe("Updated title");
		expect(updated?.narrative).toBe(obs.narrative);
	});

	test("update changes multiple fields", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		const updated = observations.update(obs.id, {
			title: "New title",
			narrative: "New narrative",
			type: "decision",
			concepts: ["new-concept"],
			importance: 5,
		});
		expect(updated).not.toBeNull();
		expect(updated?.title).toBe("New title");
		expect(updated?.narrative).toBe("New narrative");
		expect(updated?.type).toBe("decision");
		expect(updated?.concepts).toEqual(["new-concept"]);
		expect(updated?.importance).toBe(5);
	});

	test("update returns null for nonexistent id", () => {
		const { observations } = createSessionAndObs(db);
		const result = observations.update("nonexistent-id", { title: "x" });
		expect(result).toBeNull();
	});

	test("update with empty data returns unchanged observation", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		const updated = observations.update(obs.id, {});
		expect(updated).not.toBeNull();
		expect(updated?.title).toBe(obs.title);
	});

	test("update syncs FTS5 index", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData({ title: "Original title" }));
		observations.update(obs.id, { title: "Quantum computing breakthrough" });
		const results = observations.search({ query: "quantum computing" });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].observation.id).toBe(obs.id);
		const oldResults = observations.search({ query: "Original title" });
		const matchesOld = oldResults.some((r) => r.observation.id === obs.id);
		expect(matchesOld).toBe(false);
	});

	// =========================================================================
	// delete()
	// =========================================================================

	test("delete removes observation and returns true", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		const deleted = observations.delete(obs.id);
		expect(deleted).toBe(true);
		expect(observations.getById(obs.id)).toBeNull();
	});

	test("delete returns false for nonexistent id", () => {
		const { observations } = createSessionAndObs(db);
		const deleted = observations.delete("nonexistent-id");
		expect(deleted).toBe(false);
	});

	test("delete removes from FTS5 index", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData({ title: "Unique searchable zebra" }));
		observations.delete(obs.id);
		const results = observations.search({ query: "zebra" });
		expect(results).toHaveLength(0);
	});

	test("delete clears embedding column", () => {
		const { observations } = createSessionAndObs(db);
		const obs = observations.create(makeObservationData());
		observations.setEmbedding(obs.id, [0.1, 0.2, 0.3]);
		observations.delete(obs.id);
		expect(observations.getById(obs.id)).toBeNull();
	});
});

// =============================================================================
// Summary Repository
// =============================================================================

describe("SummaryRepository", () => {
	test("create returns a summary with generated id", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		const summary = repo.create({
			sessionId: "sess-1",
			summary: "Explored JWT auth patterns in the codebase.",
			keyDecisions: ["Use refresh tokens"],
			filesModified: ["src/auth.ts"],
			concepts: ["JWT", "authentication"],
			tokenCount: 80,
		});
		expect(summary.id).toBeDefined();
		expect(summary.summary).toContain("JWT");
		expect(summary.keyDecisions).toEqual(["Use refresh tokens"]);
	});

	test("getBySessionId finds summary", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		repo.create({
			sessionId: "sess-1",
			summary: "Auth exploration session.",
			keyDecisions: [],
			filesModified: [],
			concepts: ["auth"],
			tokenCount: 50,
		});
		const found = repo.getBySessionId("sess-1");
		expect(found).not.toBeNull();
		expect(found?.sessionId).toBe("sess-1");
	});

	test("getRecent returns summaries ordered by created_at DESC", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.create("sess-2", "/tmp/project");
		const repo = new SummaryRepository(db);
		repo.create({
			sessionId: "sess-1",
			summary: "First session",
			keyDecisions: [],
			filesModified: [],
			concepts: [],
			tokenCount: 10,
		});
		repo.create({
			sessionId: "sess-2",
			summary: "Second session",
			keyDecisions: [],
			filesModified: [],
			concepts: [],
			tokenCount: 10,
		});
		// Set explicit timestamps to make ordering deterministic
		db.run("UPDATE session_summaries SET created_at = ? WHERE session_id = ?", [
			"2026-01-01T00:00:00.000Z",
			"sess-1",
		]);
		db.run("UPDATE session_summaries SET created_at = ? WHERE session_id = ?", [
			"2026-01-02T00:00:00.000Z",
			"sess-2",
		]);
		const recent = repo.getRecent(10);
		expect(recent).toHaveLength(2);
		expect(recent[0].summary).toBe("Second session");
	});

	test("search FTS5 returns matching summaries", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		repo.create({
			sessionId: "sess-1",
			summary: "Implemented JWT authentication with refresh tokens.",
			keyDecisions: ["Use RS256 algorithm"],
			filesModified: ["src/auth.ts"],
			concepts: ["JWT", "authentication"],
			tokenCount: 100,
		});
		const results = repo.search("JWT authentication");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].summary).toContain("JWT");
	});

	test("create saves structured summary fields", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		const summary = repo.create({
			sessionId: "sess-1",
			summary: "Implemented structured summaries.",
			keyDecisions: ["Use v3 migration"],
			filesModified: ["src/db/schema.ts"],
			concepts: ["migration"],
			tokenCount: 120,
			request: "Add structured summary columns",
			investigated: "Checked SQLite ALTER TABLE support",
			learned: "SQLite requires separate ALTER statements",
			completed: "Added v3 migration with 5 new columns",
			nextSteps: "Update context injection to use new fields",
		});
		expect(summary.request).toBe("Add structured summary columns");
		expect(summary.nextSteps).toBe("Update context injection to use new fields");

		const found = repo.getBySessionId("sess-1");
		expect(found).not.toBeNull();
		expect(found?.request).toBe("Add structured summary columns");
		expect(found?.investigated).toBe("Checked SQLite ALTER TABLE support");
		expect(found?.learned).toBe("SQLite requires separate ALTER statements");
		expect(found?.completed).toBe("Added v3 migration with 5 new columns");
		expect(found?.nextSteps).toBe("Update context injection to use new fields");
	});

	test("backward compat: old summaries have undefined new fields", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		repo.create({
			sessionId: "sess-1",
			summary: "Old-style summary without structured fields.",
			keyDecisions: [],
			filesModified: [],
			concepts: ["legacy"],
			tokenCount: 50,
		});
		const found = repo.getBySessionId("sess-1");
		expect(found).not.toBeNull();
		expect(found?.request).toBeUndefined();
		expect(found?.investigated).toBeUndefined();
		expect(found?.learned).toBeUndefined();
		expect(found?.completed).toBeUndefined();
		expect(found?.nextSteps).toBeUndefined();
	});

	test("search FTS5 works with summaries containing new columns", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new SummaryRepository(db);
		repo.create({
			sessionId: "sess-1",
			summary: "Explored quantum computing patterns in the codebase.",
			keyDecisions: ["Use Grover algorithm"],
			filesModified: [],
			concepts: ["quantum"],
			tokenCount: 80,
			request: "Investigate quantum algorithms",
			investigated: "Reviewed Shor and Grover algorithms",
			learned: "Grover provides quadratic speedup",
			completed: "Documented quantum patterns",
			nextSteps: "Implement quantum search module",
		});
		const results = repo.search("quantum");
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].summary).toContain("quantum");
	});
});

// =============================================================================
// PendingMessage Repository
// =============================================================================

describe("PendingMessageRepository", () => {
	test("create returns a message with pending status", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new PendingMessageRepository(db);
		const msg = repo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "file contents...",
			callId: "call-123",
		});
		expect(msg.id).toBeDefined();
		expect(msg.status).toBe("pending");
		expect(msg.retryCount).toBe(0);
		expect(msg.error).toBeNull();
	});

	test("getPending returns only pending messages", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new PendingMessageRepository(db);
		const m1 = repo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output1",
			callId: "call-1",
		});
		repo.create({
			sessionId: "sess-1",
			toolName: "Bash",
			toolOutput: "output2",
			callId: "call-2",
		});
		repo.markProcessing(m1.id);

		const pending = repo.getPending();
		expect(pending).toHaveLength(1);
		expect(pending[0].callId).toBe("call-2");
	});

	test("markCompleted transitions status", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new PendingMessageRepository(db);
		const msg = repo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output",
			callId: "call-1",
		});
		repo.markProcessing(msg.id);
		repo.markCompleted(msg.id);

		const completed = repo.getByStatus("completed");
		expect(completed).toHaveLength(1);
		expect(completed[0].id).toBe(msg.id);
	});

	test("markFailed sets error and increments retryCount", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new PendingMessageRepository(db);
		const msg = repo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output",
			callId: "call-1",
		});
		repo.markProcessing(msg.id);
		repo.markFailed(msg.id, "API timeout");

		const failed = repo.getByStatus("failed");
		expect(failed).toHaveLength(1);
		expect(failed[0].error).toBe("API timeout");
		expect(failed[0].retryCount).toBe(1);
	});

	test("resetStale resets old processing messages to pending", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const repo = new PendingMessageRepository(db);
		const msg = repo.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output",
			callId: "call-1",
		});
		repo.markProcessing(msg.id);

		// Manually backdate the created_at to simulate a stale message
		db.run("UPDATE pending_messages SET created_at = datetime('now', '-10 minutes') WHERE id = ?", [
			msg.id,
		]);

		const resetCount = repo.resetStale(5);
		expect(resetCount).toBe(1);

		const pending = repo.getPending();
		expect(pending).toHaveLength(1);
		expect(pending[0].id).toBe(msg.id);
	});
});
