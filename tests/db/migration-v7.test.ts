// =============================================================================
// open-mem — Migration v7 Tests (importance column on observations)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { MIGRATIONS } from "../../src/db/schema";
import { cleanupTestDb, createRawTestDb, createTestDb } from "./helpers";

describe("Migration v7: importance column", () => {
	test("fresh DB creates observations table with importance column", () => {
		const { db, dbPath } = createTestDb();
		try {
			// Verify importance column exists with correct default
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations
					(id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-1", "sess-1", "discovery", "test", "raw", "Read"],
			);

			const row = db.get<{ importance: number }>(
				"SELECT importance FROM observations WHERE id = ?",
				["obs-1"],
			);
			expect(row).not.toBeNull();
			expect(row?.importance).toBe(3); // default value
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("migration v7 is idempotent", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			db.migrate(MIGRATIONS);
			db.migrate(MIGRATIONS); // run again — should not error

			const migrations = db.all<{ version: number }>(
				"SELECT version FROM _migrations ORDER BY version",
			);
			expect(migrations).toHaveLength(8); // v1 through v8
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("importance column can store values 1-5", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);

			for (const importance of [1, 2, 3, 4, 5]) {
				db.run(
					`INSERT INTO observations
						(id, session_id, type, title, raw_tool_output, tool_name, importance)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						`obs-${importance}`,
						"sess-1",
						"discovery",
						`test-${importance}`,
						"raw",
						"Read",
						importance,
					],
				);
			}

			for (const importance of [1, 2, 3, 4, 5]) {
				const row = db.get<{ importance: number }>(
					"SELECT importance FROM observations WHERE id = ?",
					[`obs-${importance}`],
				);
				expect(row?.importance).toBe(importance);
			}
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("existing observations get default importance of 3 after migration", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			// Run migrations v1-v6 first
			const migrationsV6 = MIGRATIONS.slice(0, 6);
			db.migrate(migrationsV6);

			// Insert an observation before v7
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations
					(id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-old", "sess-1", "discovery", "old observation", "raw", "Read"],
			);

			// Now run v7
			db.migrate(MIGRATIONS);

			const row = db.get<{ importance: number }>(
				"SELECT importance FROM observations WHERE id = ?",
				["obs-old"],
			);
			expect(row?.importance).toBe(3);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});
