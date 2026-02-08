import { describe, expect, test } from "bun:test";
import { ObservationRepository } from "../../src/db/observations";
import { MIGRATIONS } from "../../src/db/schema";
import { cleanupTestDb, createRawTestDb, createTestDb } from "./helpers";

describe("Migration v8: conflict resolution columns", () => {
	test("fresh DB has superseded_by and superseded_at columns", () => {
		const { db, dbPath } = createTestDb();
		try {
			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations
					(id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-1", "sess-1", "discovery", "test", "raw", "Read"],
			);

			const row = db.get<{ superseded_by: string | null; superseded_at: string | null }>(
				"SELECT superseded_by, superseded_at FROM observations WHERE id = ?",
				["obs-1"],
			);
			expect(row).not.toBeNull();
			expect(row?.superseded_by).toBeNull();
			expect(row?.superseded_at).toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("migration v8 is idempotent", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			db.migrate(MIGRATIONS);
			db.migrate(MIGRATIONS);

			const migrations = db.all<{ version: number }>(
				"SELECT version FROM _migrations ORDER BY version",
			);
			expect(migrations).toHaveLength(10);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("existing observations get NULL superseded_by after migration", () => {
		const { db, dbPath } = createRawTestDb();
		try {
			const migrationsV7 = MIGRATIONS.slice(0, 7);
			db.migrate(migrationsV7);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);
			db.run(
				`INSERT INTO observations
					(id, session_id, type, title, raw_tool_output, tool_name)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				["obs-old", "sess-1", "discovery", "old observation", "raw", "Read"],
			);

			db.migrate(MIGRATIONS);

			const row = db.get<{ superseded_by: string | null; superseded_at: string | null }>(
				"SELECT superseded_by, superseded_at FROM observations WHERE id = ?",
				["obs-old"],
			);
			expect(row?.superseded_by).toBeNull();
			expect(row?.superseded_at).toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("supersede() sets columns correctly", () => {
		const { db, dbPath } = createTestDb();
		try {
			const repo = new ObservationRepository(db);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);

			const obs1 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "old observation",
				subtitle: "",
				facts: [],
				narrative: "old",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			const obs2 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "new observation",
				subtitle: "",
				facts: [],
				narrative: "new",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			repo.supersede(obs1.id, obs2.id);

			const updated = db.get<{ superseded_by: string | null; superseded_at: string | null }>(
				"SELECT superseded_by, superseded_at FROM observations WHERE id = ?",
				[obs1.id],
			);
			expect(updated).not.toBeNull();
			expect(updated?.superseded_by).toBe(obs2.id);
			expect(updated?.superseded_at).not.toBeNull();

			const unchanged = repo.getById(obs2.id);
			expect(unchanged?.supersededBy).toBeNull();
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("getIndex() excludes superseded observations", () => {
		const { db, dbPath } = createTestDb();
		try {
			const repo = new ObservationRepository(db);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/proj"]);

			const obs1 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "will be superseded",
				subtitle: "",
				facts: [],
				narrative: "old",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			const obs2 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "replacement",
				subtitle: "",
				facts: [],
				narrative: "new",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			repo.supersede(obs1.id, obs2.id);

			const index = repo.getIndex("/proj");
			expect(index).toHaveLength(1);
			expect(index[0].id).toBe(obs2.id);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("search() excludes superseded observations", () => {
		const { db, dbPath } = createTestDb();
		try {
			const repo = new ObservationRepository(db);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/proj"]);

			const obs1 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "unique searchterm alpha",
				subtitle: "",
				facts: [],
				narrative: "old narrative",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			const obs2 = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "unique searchterm beta",
				subtitle: "",
				facts: [],
				narrative: "new narrative",
				concepts: [],
				filesRead: [],
				filesModified: [],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			repo.supersede(obs1.id, obs2.id);

			const results = repo.search({ query: "searchterm", projectPath: "/proj" });
			expect(results).toHaveLength(1);
			expect(results[0].observation.id).toBe(obs2.id);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("update() with new fields (facts, subtitle, filesRead, filesModified)", () => {
		const { db, dbPath } = createTestDb();
		try {
			const repo = new ObservationRepository(db);

			db.run("INSERT INTO sessions (id, project_path) VALUES (?, ?)", ["sess-1", "/tmp"]);

			const obs = repo.create({
				sessionId: "sess-1",
				type: "discovery",
				title: "test obs",
				subtitle: "original subtitle",
				facts: ["fact1"],
				narrative: "narrative",
				concepts: [],
				filesRead: ["a.ts"],
				filesModified: ["b.ts"],
				rawToolOutput: "raw",
				toolName: "Read",
				tokenCount: 10,
				discoveryTokens: 0,
				importance: 3,
			});

			const updated = repo.update(obs.id, {
				facts: ["fact1", "fact2", "fact3"],
				subtitle: "updated subtitle",
				filesRead: ["a.ts", "c.ts"],
				filesModified: ["b.ts", "d.ts"],
			});

			expect(updated).not.toBeNull();
			expect(updated?.facts).toEqual(["fact1", "fact2", "fact3"]);
			expect(updated?.subtitle).toBe("updated subtitle");
			expect(updated?.filesRead).toEqual(["a.ts", "c.ts"]);
			expect(updated?.filesModified).toEqual(["b.ts", "d.ts"]);
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});

	test("idx_observations_superseded index exists", () => {
		const { db, dbPath } = createTestDb();
		try {
			const index = db.get<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type='index' AND name='idx_observations_superseded'",
			);
			expect(index).not.toBeNull();
			expect(index?.name).toBe("idx_observations_superseded");
		} finally {
			db.close();
			cleanupTestDb(dbPath);
		}
	});
});
