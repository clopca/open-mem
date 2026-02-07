// =============================================================================
// open-mem — sqlite-vec Extension Loading Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { Database } from "../../src/db/database";
import { cleanupTestDb, createTestDb } from "./helpers";

const extensionEnabled = Database.enableExtensionSupport();

describe("sqlite-vec extension loading", () => {
	test("Database.hasVectorExtension reflects extension availability", () => {
		const { db, dbPath } = createTestDb();
		try {
			expect(typeof db.hasVectorExtension).toBe("boolean");
			if (extensionEnabled) {
				expect(db.hasVectorExtension).toBe(true);
			}
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("Database still works normally after extension loading", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.exec("CREATE TABLE test_vec (id INTEGER PRIMARY KEY, name TEXT)");
			db.run("INSERT INTO test_vec (name) VALUES (?)", ["hello"]);
			const row = db.get<{ id: number; name: string }>("SELECT * FROM test_vec WHERE id = 1");
			expect(row).not.toBeNull();
			expect(row?.name).toBe("hello");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("vec_version() function is available when extension is loaded", () => {
		const { db, dbPath } = createTestDb();
		try {
			if (db.hasVectorExtension) {
				const result = db.get<{ version: string }>("SELECT vec_version() as version");
				expect(result).not.toBeNull();
				expect(typeof result?.version).toBe("string");
			}
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});
