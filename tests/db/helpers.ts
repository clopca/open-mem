// =============================================================================
// open-mem — Test Helpers for Database Tests
// =============================================================================

import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { createDatabase, type Database } from "../../src/db/database";
import { initializeSchema } from "../../src/db/schema";

/** Create an isolated test database with full schema applied */
export function createTestDb(): { db: Database; dbPath: string } {
	const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
	const db = createDatabase(dbPath);
	initializeSchema(db);
	return { db, dbPath };
}

/** Create a raw database (no schema) for testing migrations */
export function createRawTestDb(): { db: Database; dbPath: string } {
	const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
	const db = createDatabase(dbPath);
	return { db, dbPath };
}

/** Clean up a temp database file and its WAL/SHM sidecars */
export function cleanupTestDb(dbPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(dbPath + suffix);
		} catch {
			// file may not exist
		}
	}
}
