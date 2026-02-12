// =============================================================================
// open-mem — Retention Enforcement Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { SessionRepository } from "../../src/db/sessions";
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
// Helpers
// =============================================================================

function makeObservationData(overrides?: Record<string, unknown>) {
	return {
		sessionId: "sess-1",
		type: "discovery" as const,
		title: "Test observation",
		subtitle: "subtitle",
		facts: ["fact1"],
		narrative: "narrative text",
		concepts: ["concept1"],
		filesRead: ["src/file.ts"],
		filesModified: [] as string[],
		rawToolOutput: "raw output...",
		toolName: "Read",
		tokenCount: 100,
		discoveryTokens: 0,
		...overrides,
	};
}

// =============================================================================
// ObservationRepository.deleteOlderThan
// =============================================================================

describe("ObservationRepository.deleteOlderThan", () => {
	test("deletes observations older than N days", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.markCompleted("sess-1");

		// Create observation, then backdate it to 100 days ago
		const obs = observations.create(makeObservationData());
		db.run("UPDATE observations SET created_at = datetime('now', '-100 days') WHERE id = ?", [
			obs.id,
		]);

		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(1);
		expect(observations.getById(obs.id)).toBeNull();
	});

	test("does NOT delete recent observations", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.markCompleted("sess-1");

		const obs = observations.create(makeObservationData());
		// obs was just created (now) — should NOT be deleted with 90-day retention
		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(0);
		expect(observations.getById(obs.id)).not.toBeNull();
	});

	test("does NOT delete observations from active (non-completed) sessions", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-active", "/tmp/project");
		// Session is active (not completed)

		const obs = observations.create(makeObservationData({ sessionId: "sess-active" }));
		db.run("UPDATE observations SET created_at = datetime('now', '-200 days') WHERE id = ?", [
			obs.id,
		]);

		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(0);
		expect(observations.getById(obs.id)).not.toBeNull();
	});

	test("does NOT delete observations from idle sessions", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-idle", "/tmp/project");
		sessions.updateStatus("sess-idle", "idle");

		const obs = observations.create(makeObservationData({ sessionId: "sess-idle" }));
		db.run("UPDATE observations SET created_at = datetime('now', '-200 days') WHERE id = ?", [
			obs.id,
		]);

		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(0);
		expect(observations.getById(obs.id)).not.toBeNull();
	});

	test("deletes multiple old observations across completed sessions", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.create("sess-2", "/tmp/project");
		sessions.markCompleted("sess-1");
		sessions.markCompleted("sess-2");

		const obs1 = observations.create(makeObservationData({ sessionId: "sess-1" }));
		const obs2 = observations.create(makeObservationData({ sessionId: "sess-2" }));
		const obs3 = observations.create(makeObservationData({ sessionId: "sess-1" }));

		db.run("UPDATE observations SET created_at = datetime('now', '-100 days') WHERE id IN (?, ?)", [
			obs1.id,
			obs2.id,
		]);
		// obs3 is recent — should NOT be deleted

		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(2);
		expect(observations.getById(obs1.id)).toBeNull();
		expect(observations.getById(obs2.id)).toBeNull();
		expect(observations.getById(obs3.id)).not.toBeNull();
	});

	test("FTS5 delete trigger works — search returns no results after deletion", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.markCompleted("sess-1");

		const obs = observations.create(makeObservationData({ title: "UniqueRetentionTestTitleXYZ" }));

		// Verify search finds it
		const before = observations.search({ query: "UniqueRetentionTestTitleXYZ" });
		expect(before.length).toBe(1);

		// Backdate and delete
		db.run("UPDATE observations SET created_at = datetime('now', '-100 days') WHERE id = ?", [
			obs.id,
		]);
		observations.deleteOlderThan(90);

		// Verify search no longer finds it (FTS5 trigger exercised)
		const after = observations.search({ query: "UniqueRetentionTestTitleXYZ" });
		expect(after.length).toBe(0);
	});

	test("returns 0 when no observations match", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.markCompleted("sess-1");

		// No observations at all
		const deleted = observations.deleteOlderThan(90);
		expect(deleted).toBe(0);
	});
});

// =============================================================================
// ObservationRepository.deleteEmbeddingsForObservations
// =============================================================================

describe("ObservationRepository.deleteEmbeddingsForObservations", () => {
	test("clears embedding column for specified observation IDs", () => {
		const sessions = new SessionRepository(db);
		const observations = new ObservationRepository(db);
		sessions.create("sess-1", "/tmp/project");

		const obs = observations.create(makeObservationData());
		observations.setEmbedding(obs.id, [0.1, 0.2, 0.3]);

		// Verify embedding was set
		const beforeRow = db.get<{ embedding: string | null }>(
			"SELECT embedding FROM observations WHERE id = ?",
			[obs.id],
		);
		expect(beforeRow?.embedding).not.toBeNull();

		observations.deleteEmbeddingsForObservations([obs.id]);

		const afterRow = db.get<{ embedding: string | null }>(
			"SELECT embedding FROM observations WHERE id = ?",
			[obs.id],
		);
		expect(afterRow?.embedding).toBeNull();
	});

	test("handles empty ID list gracefully", () => {
		const observations = new ObservationRepository(db);
		// Should not throw
		observations.deleteEmbeddingsForObservations([]);
	});
});

// =============================================================================
// PendingMessageRepository.deleteCompletedOlderThan
// =============================================================================

describe("PendingMessageRepository.deleteCompletedOlderThan", () => {
	test("deletes completed messages older than N days", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const pending = new PendingMessageRepository(db);

		const msg = pending.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output",
			callId: "call-1",
		});
		pending.markCompleted(msg.id);

		// Backdate to 100 days ago
		db.run("UPDATE pending_messages SET created_at = datetime('now', '-100 days') WHERE id = ?", [
			msg.id,
		]);

		const deleted = pending.deleteCompletedOlderThan(90);
		expect(deleted).toBe(1);
		expect(pending.getByStatus("completed")).toHaveLength(0);
	});

	test("does NOT delete recent completed messages", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const pending = new PendingMessageRepository(db);

		const msg = pending.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output",
			callId: "call-1",
		});
		pending.markCompleted(msg.id);

		const deleted = pending.deleteCompletedOlderThan(90);
		expect(deleted).toBe(0);
		expect(pending.getByStatus("completed")).toHaveLength(1);
	});

	test("does NOT delete pending or failed messages even if old", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const pending = new PendingMessageRepository(db);

		const msg1 = pending.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output1",
			callId: "call-1",
		});
		const msg2 = pending.create({
			sessionId: "sess-1",
			toolName: "Read",
			toolOutput: "output2",
			callId: "call-2",
		});
		pending.markFailed(msg2.id, "error");

		// Backdate both
		db.run(
			"UPDATE pending_messages SET created_at = datetime('now', '-100 days') WHERE id IN (?, ?)",
			[msg1.id, msg2.id],
		);

		const deleted = pending.deleteCompletedOlderThan(90);
		expect(deleted).toBe(0);
		// msg1 is pending, msg2 is failed — both preserved
		expect(pending.getPending()).toHaveLength(1);
		expect(pending.getByStatus("failed")).toHaveLength(1);
	});

	test("returns 0 when no completed messages match", () => {
		const pending = new PendingMessageRepository(db);
		const deleted = pending.deleteCompletedOlderThan(90);
		expect(deleted).toBe(0);
	});
});
