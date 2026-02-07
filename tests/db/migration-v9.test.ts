import { describe, expect, test } from "bun:test";
import { MIGRATIONS } from "../../src/db/schema";
import { cleanupTestDb, createRawTestDb, createTestDb } from "./helpers";

describe("Migration v9: entity graph tables", () => {
	test("fresh DB creates all entity tables", () => {
		const { db, dbPath } = createTestDb();
		try {
			const tables = db
				.all<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'entit%' ORDER BY name",
				)
				.map((r) => r.name);

			expect(tables).toContain("entities");
			expect(tables).toContain("entity_observations");
			expect(tables).toContain("entity_relations");

			const fts = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='entities_fts'",
			);
			expect(fts).not.toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("migration is idempotent", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			db.migrate(MIGRATIONS);
			db.migrate(MIGRATIONS);

			const migrations = db.all<{ version: number }>(
				"SELECT version FROM _migrations ORDER BY version",
			);
			expect(migrations).toHaveLength(9);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("entities table has correct columns and unique constraints", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "React", "library"],
			);

			const row = db.get<{
				id: string;
				name: string;
				entity_type: string;
				mention_count: number;
				first_seen_at: string;
				last_seen_at: string;
			}>("SELECT * FROM entities WHERE id = ?", ["ent-1"]);

			expect(row).not.toBeNull();
			expect(row?.name).toBe("React");
			expect(row?.entity_type).toBe("library");
			expect(row?.mention_count).toBe(1);
			expect(row?.first_seen_at).toBeTruthy();
			expect(row?.last_seen_at).toBeTruthy();

			expect(() => {
				db.run(
					`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
					["ent-2", "React", "library"],
				);
			}).toThrow();

			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-3", "React", "concept"],
			);
			const count = db.get<{ cnt: number }>(
				"SELECT COUNT(*) as cnt FROM entities WHERE name = 'React'",
			);
			expect(count?.cnt).toBe(2);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("entity_type CHECK constraint rejects invalid types", () => {
		const { db, dbPath } = createTestDb();
		try {
			expect(() => {
				db.run(
					`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
					["ent-1", "Foo", "invalid_type"],
				);
			}).toThrow();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("entity_relations table has correct columns and foreign keys", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations (id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-1", "sess-1", "discovery", "test", "raw", "Read"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "React", "library"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-2", "Next.js", "library"],
			);

			db.run(
				`INSERT INTO entity_relations (id, source_entity_id, target_entity_id, relationship, observation_id)
				 VALUES (?, ?, ?, ?, ?)`,
				["rel-1", "ent-1", "ent-2", "uses", "obs-1"],
			);

			const row = db.get<{
				id: string;
				source_entity_id: string;
				target_entity_id: string;
				relationship: string;
				observation_id: string;
				created_at: string;
			}>("SELECT * FROM entity_relations WHERE id = ?", ["rel-1"]);

			expect(row).not.toBeNull();
			expect(row?.source_entity_id).toBe("ent-1");
			expect(row?.target_entity_id).toBe("ent-2");
			expect(row?.relationship).toBe("uses");
			expect(row?.observation_id).toBe("obs-1");
			expect(row?.created_at).toBeTruthy();

			expect(() => {
				db.run(
					`INSERT INTO entity_relations (id, source_entity_id, target_entity_id, relationship, observation_id)
					 VALUES (?, ?, ?, ?, ?)`,
					["rel-2", "ent-1", "ent-2", "uses", "obs-1"],
				);
			}).toThrow();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("relationship CHECK constraint rejects invalid relationships", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations (id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-1", "sess-1", "discovery", "test", "raw", "Read"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "A", "technology"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-2", "B", "technology"],
			);

			expect(() => {
				db.run(
					`INSERT INTO entity_relations (id, source_entity_id, target_entity_id, relationship, observation_id)
					 VALUES (?, ?, ?, ?, ?)`,
					["rel-1", "ent-1", "ent-2", "invalid_rel", "obs-1"],
				);
			}).toThrow();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("entity_observations junction table works correctly", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations (id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-1", "sess-1", "discovery", "test", "raw", "Read"],
			);
			db.run(
				`INSERT INTO observations (id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-2", "sess-1", "feature", "test2", "raw", "Read"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "React", "library"],
			);

			db.run(
				`INSERT INTO entity_observations (entity_id, observation_id) VALUES (?, ?)`,
				["ent-1", "obs-1"],
			);
			db.run(
				`INSERT INTO entity_observations (entity_id, observation_id) VALUES (?, ?)`,
				["ent-1", "obs-2"],
			);

			const rows = db.all<{ observation_id: string }>(
				"SELECT observation_id FROM entity_observations WHERE entity_id = ?",
				["ent-1"],
			);
			expect(rows).toHaveLength(2);

			expect(() => {
				db.run(
					`INSERT INTO entity_observations (entity_id, observation_id) VALUES (?, ?)`,
					["ent-1", "obs-1"],
				);
			}).toThrow();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("entities_fts search works", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "React", "library"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-2", "TypeScript", "technology"],
			);
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-3", "Singleton Pattern", "pattern"],
			);

			const results = db.all<{ name: string }>(
				"SELECT e.name FROM entities e JOIN entities_fts f ON e._rowid = f.rowid WHERE entities_fts MATCH ?",
				["React"],
			);
			expect(results).toHaveLength(1);
			expect(results[0].name).toBe("React");

			const typeResults = db.all<{ name: string }>(
				"SELECT e.name FROM entities e JOIN entities_fts f ON e._rowid = f.rowid WHERE entities_fts MATCH ?",
				["library"],
			);
			expect(typeResults).toHaveLength(1);
			expect(typeResults[0].name).toBe("React");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("FTS5 triggers keep index in sync on update and delete", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run(
				`INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)`,
				["ent-1", "React", "library"],
			);

			db.run("UPDATE entities SET name = ? WHERE id = ?", ["Vue", "ent-1"]);

			const oldResults = db.all<{ name: string }>(
				"SELECT e.name FROM entities e JOIN entities_fts f ON e._rowid = f.rowid WHERE entities_fts MATCH ?",
				["React"],
			);
			expect(oldResults).toHaveLength(0);

			const newResults = db.all<{ name: string }>(
				"SELECT e.name FROM entities e JOIN entities_fts f ON e._rowid = f.rowid WHERE entities_fts MATCH ?",
				["Vue"],
			);
			expect(newResults).toHaveLength(1);
			expect(newResults[0].name).toBe("Vue");

			db.run("DELETE FROM entities WHERE id = ?", ["ent-1"]);

			const deletedResults = db.all<{ name: string }>(
				"SELECT e.name FROM entities e JOIN entities_fts f ON e._rowid = f.rowid WHERE entities_fts MATCH ?",
				["Vue"],
			);
			expect(deletedResults).toHaveLength(0);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("existing data preserved after migration from v8 to v9", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			const migrationsV8 = MIGRATIONS.slice(0, 8);
			db.migrate(migrationsV8);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations
					(id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-old", "sess-1", "discovery", "old observation", "raw", "Read"],
			);

			db.migrate(MIGRATIONS);

			const obs = db.get<{ id: string; title: string }>(
				"SELECT id, title FROM observations WHERE id = ?",
				["obs-old"],
			);
			expect(obs).not.toBeNull();
			expect(obs?.title).toBe("old observation");

			const sess = db.get<{ id: string }>(
				"SELECT id FROM sessions WHERE id = ?",
				["sess-1"],
			);
			expect(sess).not.toBeNull();

			const entities = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='entities'",
			);
			expect(entities).not.toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("indexes exist on entity tables", () => {
		const { db, dbPath } = createTestDb();
		try {
			const indexes = db
				.all<{ name: string }>(
					"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_entit%' ORDER BY name",
				)
				.map((r) => r.name);

			expect(indexes).toContain("idx_entities_name");
			expect(indexes).toContain("idx_entities_type");
			expect(indexes).toContain("idx_entity_relations_source");
			expect(indexes).toContain("idx_entity_relations_target");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});
