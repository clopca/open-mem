// =============================================================================
// open-mem — Schema and FTS5 Tests (Task 06)
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { initializeSchema } from "../../src/db/schema";
import { cleanupTestDb, createRawTestDb, createTestDb } from "./helpers";

let cleanupPaths: string[] = [];

afterEach(() => {
	for (const p of cleanupPaths) cleanupTestDb(p);
	cleanupPaths = [];
});

describe("Schema and FTS5", () => {
	test("initializeSchema creates all core tables", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		const tables = db
			.all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != '_migrations' ORDER BY name",
			)
			.map((r) => r.name);

		expect(tables).toContain("sessions");
		expect(tables).toContain("observations");
		expect(tables).toContain("session_summaries");
		expect(tables).toContain("pending_messages");
		db.close();
	});

	test("initializeSchema creates FTS5 tables", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		const tables = db
			.all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_fts' ORDER BY name",
			)
			.map((r) => r.name);

		expect(tables).toContain("observations_fts");
		expect(tables).toContain("summaries_fts");
		db.close();
	});

	test("initializeSchema creates indexes", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		const indexes = db
			.all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
			)
			.map((r) => r.name);

		expect(indexes).toContain("idx_sessions_project");
		expect(indexes).toContain("idx_sessions_status");
		expect(indexes).toContain("idx_sessions_started");
		expect(indexes).toContain("idx_observations_session");
		expect(indexes).toContain("idx_observations_type");
		expect(indexes).toContain("idx_observations_created");
		expect(indexes).toContain("idx_pending_status");
		expect(indexes).toContain("idx_pending_session");
		db.close();
	});

	test("initializeSchema is idempotent", () => {
		const { db, dbPath } = createRawTestDb();
		cleanupPaths.push(dbPath);
		initializeSchema(db);
		initializeSchema(db); // run again — should not error
		const migrations = db.all<{ version: number }>(
			"SELECT version FROM _migrations ORDER BY version",
		);
		expect(migrations).toHaveLength(10); // v1 through v10
		db.close();
	});

	test("observations type CHECK constraint rejects invalid values", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
		expect(() => {
			db.run(
				"INSERT INTO observations (id, session_id, type, title, raw_tool_output, tool_name) VALUES (?, ?, ?, ?, ?, ?)",
				["obs-1", "sess-1", "INVALID_TYPE", "title", "output", "tool"],
			);
		}).toThrow();
		db.close();
	});

	test("sessions status CHECK constraint rejects invalid values", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		expect(() => {
			db.run("INSERT INTO sessions (id, project_path, status) VALUES (?, ?, ?)", [
				"sess-1",
				"/tmp",
				"INVALID_STATUS",
			]);
		}).toThrow();
		db.close();
	});

	test("FTS5 trigger syncs on INSERT", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
		db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output, tool_name, token_count)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"obs-1",
				"sess-1",
				"discovery",
				"JWT authentication pattern",
				"auth module",
				'["uses JWT"]',
				"Found JWT auth in the codebase",
				'["authentication","JWT"]',
				'["src/auth.ts"]',
				"[]",
				"raw output",
				"Read",
				100,
			],
		);

		const results = db.all<{ title: string }>(
			"SELECT title FROM observations_fts WHERE observations_fts MATCH ?",
			["JWT"],
		);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("JWT authentication pattern");
		db.close();
	});

	test("FTS5 trigger syncs on DELETE", () => {
		const { db, dbPath } = createTestDb();
		cleanupPaths.push(dbPath);
		db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
		db.run(
			`INSERT INTO observations
				(id, session_id, type, title, raw_tool_output, tool_name)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			["obs-1", "sess-1", "discovery", "JWT auth", "raw", "Read"],
		);

		// Verify it's in FTS
		let results = db.all<Record<string, unknown>>(
			"SELECT * FROM observations_fts WHERE observations_fts MATCH ?",
			["JWT"],
		);
		expect(results).toHaveLength(1);

		// Delete the observation
		db.run("DELETE FROM observations WHERE id = ?", ["obs-1"]);

		// FTS should be empty
		results = db.all<Record<string, unknown>>(
			"SELECT * FROM observations_fts WHERE observations_fts MATCH ?",
			["JWT"],
		);
		expect(results).toHaveLength(0);
		db.close();
	});
});
