// =============================================================================
// open-mem — message.removed Event Handling Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { createEventHandler } from "../../src/hooks/session-events";
import { getDefaultConfig } from "../../src/config";
import { Logger } from "../../src/utils/logger";
import type { Database } from "../../src/db/database";
import type { OpenMemConfig } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

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

function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
	return { ...getDefaultConfig(), ...overrides };
}

function makeMockQueue() {
	return {
		async processBatch() {
			return 0;
		},
		async summarizeSession() {},
	};
}

function makeMockPending() {
	return {
		deleteCompletedOlderThan: () => 0,
		deleteBySessionId: () => 0,
	};
}

function makeObservationData(overrides?: Record<string, unknown>) {
	return {
		sessionId: "sess-1",
		type: "discovery" as const,
		title: "Test observation",
		subtitle: "",
		facts: [] as string[],
		narrative: "Test narrative",
		concepts: [] as string[],
		filesRead: [] as string[],
		filesModified: [] as string[],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 50,
		...overrides,
	};
}

// =============================================================================
// softDeleteByMessageId — Repository Tests
// =============================================================================

describe("ObservationRepository.softDeleteByMessageId", () => {
	test("soft-deletes observations with matching session_id and message_id", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-1" }));
		observations.create(makeObservationData({ messageId: "msg-1" }));
		observations.create(makeObservationData({ messageId: "msg-2" }));

		const count = observations.softDeleteByMessageId("sess-1", "msg-1");
		expect(count).toBe(2);

		// Only msg-2 observation should still be visible
		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
		expect(remaining[0].messageId).toBe("msg-2");
	});

	test("does NOT affect observations with different message_id", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-target" }));
		observations.create(makeObservationData({ messageId: "msg-other" }));

		const count = observations.softDeleteByMessageId("sess-1", "msg-target");
		expect(count).toBe(1);

		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
		expect(remaining[0].messageId).toBe("msg-other");
	});

	test("does NOT affect observations with different session_id", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		sessions.create("sess-2", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ sessionId: "sess-1", messageId: "msg-1" }));
		observations.create(makeObservationData({ sessionId: "sess-2", messageId: "msg-1" }));

		const count = observations.softDeleteByMessageId("sess-1", "msg-1");
		expect(count).toBe(1);

		// sess-2 observation should still be there
		const sess2Obs = observations.getBySession("sess-2");
		expect(sess2Obs).toHaveLength(1);
	});

	test("returns 0 when no matches found", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-1" }));

		const count = observations.softDeleteByMessageId("sess-1", "nonexistent-msg");
		expect(count).toBe(0);

		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
	});

	test("does not double-delete already soft-deleted observations", () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-1" }));

		// First delete
		const count1 = observations.softDeleteByMessageId("sess-1", "msg-1");
		expect(count1).toBe(1);

		// Second delete should return 0 (already deleted)
		const count2 = observations.softDeleteByMessageId("sess-1", "msg-1");
		expect(count2).toBe(0);
	});
});

// =============================================================================
// message.removed — Event Handler Tests
// =============================================================================

describe("message.removed event handler", () => {
	test("calls softDeleteByMessageId when receiving message.removed event", async () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		// Create observations tied to a message
		observations.create(makeObservationData({ messageId: "msg-to-remove" }));
		observations.create(makeObservationData({ messageId: "msg-to-keep" }));

		const handler = createEventHandler(
			makeMockQueue() as never,
			sessions as never,
			"/tmp/project",
			makeConfig({ folderContextEnabled: false }),
			observations as never,
			makeMockPending() as never,
			new Logger("debug"),
		);

		await handler({
			event: {
				type: "message.removed",
				properties: { sessionID: "sess-1", messageID: "msg-to-remove" },
			},
		});

		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
		expect(remaining[0].messageId).toBe("msg-to-keep");
	});

	test("does nothing when message.removed has no sessionID", async () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-1" }));

		const handler = createEventHandler(
			makeMockQueue() as never,
			sessions as never,
			"/tmp/project",
			makeConfig({ folderContextEnabled: false }),
			observations as never,
			makeMockPending() as never,
			new Logger("debug"),
		);

		await handler({
			event: {
				type: "message.removed",
				properties: { messageID: "msg-1" },
			},
		});

		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
	});

	test("does nothing when message.removed has no messageID", async () => {
		const sessions = new SessionRepository(db);
		sessions.create("sess-1", "/tmp/project");
		const observations = new ObservationRepository(db);

		observations.create(makeObservationData({ messageId: "msg-1" }));

		const handler = createEventHandler(
			makeMockQueue() as never,
			sessions as never,
			"/tmp/project",
			makeConfig({ folderContextEnabled: false }),
			observations as never,
			makeMockPending() as never,
			new Logger("debug"),
		);

		await handler({
			event: {
				type: "message.removed",
				properties: { sessionID: "sess-1" },
			},
		});

		const remaining = observations.getBySession("sess-1");
		expect(remaining).toHaveLength(1);
	});
});
