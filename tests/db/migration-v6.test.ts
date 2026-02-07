// =============================================================================
// open-mem — Migration v6 Tests (embedding_meta + vec0 virtual table)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { MIGRATIONS, initializeSchema, initializeVec0Table } from "../../src/db/schema";
import { cleanupTestDb, createRawTestDb, createTestDb } from "./helpers";

const extensionEnabled = Database.enableExtensionSupport();

// -----------------------------------------------------------------------------
// Helper: insert a fake observation with a TEXT embedding
// -----------------------------------------------------------------------------

function insertObservationWithEmbedding(
	db: Database,
	sessionId: string,
	embedding: string | null,
): string {
	const id = randomUUID();
	db.run(
		`INSERT INTO observations
			(id, session_id, type, title, subtitle, facts, narrative,
			 concepts, files_read, files_modified, raw_tool_output,
			 tool_name, created_at, token_count, discovery_tokens, embedding)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?)`,
		[
			id,
			sessionId,
			"discovery",
			"Test observation",
			"subtitle",
			"[]",
			"narrative",
			"[]",
			"[]",
			"[]",
			"raw output",
			"test-tool",
			100,
			0,
			embedding,
		],
	);
	return id;
}

function insertSession(db: Database): string {
	const id = randomUUID();
	db.run("INSERT INTO sessions (id, project_path, status) VALUES (?, ?, ?)", [
		id,
		"/test/project",
		"active",
	]);
	return id;
}

// -----------------------------------------------------------------------------
// Tests: _embedding_meta table creation
// -----------------------------------------------------------------------------

describe("Migration v6: _embedding_meta table", () => {
	test("fresh DB creates _embedding_meta table", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			db.migrate(MIGRATIONS);

			const table = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='_embedding_meta'",
			);
			expect(table).not.toBeNull();
			expect(table?.name).toBe("_embedding_meta");

			// Verify columns
			db.run("INSERT INTO _embedding_meta (key, value) VALUES (?, ?)", ["test_key", "test_value"]);
			const row = db.get<{ key: string; value: string }>(
				"SELECT key, value FROM _embedding_meta WHERE key = ?",
				["test_key"],
			);
			expect(row?.key).toBe("test_key");
			expect(row?.value).toBe("test_value");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("migration v6 is idempotent (running twice doesn't fail)", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			// Run all migrations twice
			db.migrate(MIGRATIONS);
			db.migrate(MIGRATIONS);

			const table = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='_embedding_meta'",
			);
			expect(table).not.toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});

// -----------------------------------------------------------------------------
// Tests: vec0 virtual table creation
// -----------------------------------------------------------------------------

describe("Migration v6: observation_embeddings vec0 table", () => {
	test("initializeSchema with vec extension creates observation_embeddings", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				// Skip if no vec extension
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 768 });

			const table = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='observation_embeddings'",
			);
			expect(table).not.toBeNull();
			expect(table?.name).toBe("observation_embeddings");

			// Verify dimension stored in meta
			const meta = db.get<{ value: string }>(
				"SELECT value FROM _embedding_meta WHERE key = 'dimension'",
			);
			expect(meta?.value).toBe("768");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("initializeSchema without vec extension skips vec0 table", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			initializeSchema(db, { hasVectorExtension: false, embeddingDimension: 768 });

			const table = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='observation_embeddings'",
			);
			expect(table).toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("initializeSchema without options works (backward compatible)", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			initializeSchema(db);

			// _embedding_meta should exist (from migration)
			const metaTable = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='_embedding_meta'",
			);
			expect(metaTable).not.toBeNull();

			// observation_embeddings should NOT exist (no vec options)
			const vecTable = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='observation_embeddings'",
			);
			expect(vecTable).toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("initializeVec0Table is idempotent", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			db.migrate(MIGRATIONS);
			initializeVec0Table(db, 768);
			initializeVec0Table(db, 768); // second call should not fail

			const meta = db.get<{ value: string }>(
				"SELECT value FROM _embedding_meta WHERE key = 'dimension'",
			);
			expect(meta?.value).toBe("768");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});

// -----------------------------------------------------------------------------
// Tests: migrateExistingEmbeddings
// -----------------------------------------------------------------------------

describe("Migration v6: migrateExistingEmbeddings", () => {
	test("existing TEXT embeddings are migrated to vec0", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);

			// Insert observations with valid TEXT embeddings
			const id1 = insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0, 3.0]));
			const id2 = insertObservationWithEmbedding(db, sessionId, JSON.stringify([4.0, 5.0, 6.0]));

			const repo = new ObservationRepository(db);
			const result = repo.migrateExistingEmbeddings(3);

			expect(result.migrated).toBe(2);
			expect(result.skipped).toBe(0);

			// Verify data in vec0 table
			const vecRow = db.get<{ observation_id: string }>(
				"SELECT observation_id FROM observation_embeddings WHERE observation_id = ?",
				[id1],
			);
			expect(vecRow).not.toBeNull();
			expect(vecRow?.observation_id).toBe(id1);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("corrupt JSON embeddings are skipped without error", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);

			// Valid embedding
			insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0, 3.0]));
			// Corrupt JSON
			insertObservationWithEmbedding(db, sessionId, "not-valid-json{{{");
			// Empty string
			insertObservationWithEmbedding(db, sessionId, "");

			const repo = new ObservationRepository(db);
			const result = repo.migrateExistingEmbeddings(3);

			expect(result.migrated).toBe(1);
			expect(result.skipped).toBe(2);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("dimension mismatch embeddings are skipped", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);

			// Correct dimension (3)
			insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0, 3.0]));
			// Wrong dimension (5)
			insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0, 3.0, 4.0, 5.0]));
			// Wrong dimension (2)
			insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0]));
			// Not an array
			insertObservationWithEmbedding(db, sessionId, JSON.stringify({ foo: "bar" }));

			const repo = new ObservationRepository(db);
			const result = repo.migrateExistingEmbeddings(3);

			expect(result.migrated).toBe(1);
			expect(result.skipped).toBe(3);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("migration is idempotent (running twice doesn't duplicate)", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);

			insertObservationWithEmbedding(db, sessionId, JSON.stringify([1.0, 2.0, 3.0]));

			const repo = new ObservationRepository(db);

			// First run
			const result1 = repo.migrateExistingEmbeddings(3);
			expect(result1.migrated).toBe(1);

			// Second run — INSERT OR REPLACE should not fail
			const result2 = repo.migrateExistingEmbeddings(3);
			expect(result2.migrated).toBe(1);

			// Should still have exactly 1 row
			const count = db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM observation_embeddings");
			expect(count?.cnt).toBe(1);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});

// -----------------------------------------------------------------------------
// Tests: insertVecEmbedding
// -----------------------------------------------------------------------------

describe("Migration v6: insertVecEmbedding", () => {
	test("inserts embedding into vec0 table", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);
			const obsId = insertObservationWithEmbedding(db, sessionId, null);

			const repo = new ObservationRepository(db);
			repo.insertVecEmbedding(obsId, [1.0, 2.0, 3.0]);

			const row = db.get<{ observation_id: string }>(
				"SELECT observation_id FROM observation_embeddings WHERE observation_id = ?",
				[obsId],
			);
			expect(row).not.toBeNull();
			expect(row?.observation_id).toBe(obsId);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("INSERT OR REPLACE overwrites existing embedding", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			if (!db.hasVectorExtension) {
				expect(true).toBe(true);
				return;
			}

			initializeSchema(db, { hasVectorExtension: true, embeddingDimension: 3 });
			const sessionId = insertSession(db);
			const obsId = insertObservationWithEmbedding(db, sessionId, null);

			const repo = new ObservationRepository(db);
			repo.insertVecEmbedding(obsId, [1.0, 2.0, 3.0]);
			repo.insertVecEmbedding(obsId, [4.0, 5.0, 6.0]); // should not throw

			const count = db.get<{ cnt: number }>(
				"SELECT COUNT(*) as cnt FROM observation_embeddings WHERE observation_id = ?",
				[obsId],
			);
			expect(count?.cnt).toBe(1);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});
