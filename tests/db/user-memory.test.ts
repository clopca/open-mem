// =============================================================================
// open-mem — User-Level Memory Database Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import {
	UserMemoryDatabase,
	UserObservationRepository,
	type UserObservation,
} from "../../src/db/user-memory";
import type { Database } from "../../src/db/database";

let userDb: UserMemoryDatabase;
let dbPath: string;
let repo: UserObservationRepository;

function createUserTestDb(): { userDb: UserMemoryDatabase; dbPath: string } {
	const dbPath = `/tmp/open-mem-user-test-${randomUUID()}.db`;
	const userDb = new UserMemoryDatabase(dbPath);
	return { userDb, dbPath };
}

function cleanupUserTestDb(dbPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(dbPath + suffix);
		} catch {
			// file may not exist
		}
	}
}

function makeUserObservationData(
	overrides?: Partial<Omit<UserObservation, "id" | "createdAt">>,
): Omit<UserObservation, "id" | "createdAt"> {
	return {
		type: "discovery",
		title: "Found JWT authentication pattern",
		subtitle: "In the auth module",
		facts: ["Uses JWT tokens", "Tokens expire in 1 hour"],
		narrative: "Discovered that the auth module uses JWT tokens with 1 hour expiry.",
		concepts: ["authentication", "JWT"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		toolName: "Read",
		tokenCount: 150,
		importance: 3,
		sourceProject: "/tmp/project-a",
		...overrides,
	};
}

beforeEach(() => {
	const result = createUserTestDb();
	userDb = result.userDb;
	dbPath = result.dbPath;
	repo = new UserObservationRepository(userDb.database);
});

afterEach(() => {
	userDb.close();
	cleanupUserTestDb(dbPath);
});

// =============================================================================
// UserMemoryDatabase
// =============================================================================

describe("UserMemoryDatabase", () => {
	test("creates DB with WAL mode", () => {
		const row = userDb.database.get<{ journal_mode: string }>("PRAGMA journal_mode");
		expect(row?.journal_mode).toBe("wal");
	});

	test("schema creates user_observations table", () => {
		const tables = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='user_observations'",
		);
		expect(tables).toHaveLength(1);
	});

	test("schema creates FTS5 virtual table", () => {
		const tables = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='user_observations_fts'",
		);
		expect(tables).toHaveLength(1);
	});

	test("schema creates indexes", () => {
		const indexes = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_user_obs_%'",
		);
		expect(indexes.length).toBeGreaterThanOrEqual(3);
	});

	test("schema creates sync triggers", () => {
		const triggers = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'user_observations_%'",
		);
		expect(triggers).toHaveLength(3);
	});

	test("busy_timeout is set", () => {
		const row = userDb.database.get<{ timeout: number }>("PRAGMA busy_timeout");
		expect(row?.timeout).toBe(5000);
	});
});

// =============================================================================
// UserObservationRepository — CRUD
// =============================================================================

describe("UserObservationRepository", () => {
	test("create returns observation with generated id and timestamp", () => {
		const obs = repo.create(makeUserObservationData());
		expect(obs.id).toBeDefined();
		expect(obs.id.length).toBeGreaterThan(0);
		expect(obs.createdAt).toBeDefined();
		expect(obs.title).toBe("Found JWT authentication pattern");
		expect(obs.facts).toEqual(["Uses JWT tokens", "Tokens expire in 1 hour"]);
		expect(obs.sourceProject).toBe("/tmp/project-a");
	});

	test("create + getById roundtrip", () => {
		const created = repo.create(makeUserObservationData());
		const fetched = repo.getById(created.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.id).toBe(created.id);
		expect(fetched?.title).toBe(created.title);
		expect(fetched?.facts).toEqual(created.facts);
		expect(fetched?.concepts).toEqual(created.concepts);
		expect(fetched?.filesRead).toEqual(created.filesRead);
		expect(fetched?.filesModified).toEqual(created.filesModified);
		expect(fetched?.sourceProject).toBe(created.sourceProject);
		expect(fetched?.importance).toBe(created.importance);
	});

	test("getById returns null for missing id", () => {
		expect(repo.getById("nonexistent")).toBeNull();
	});

	test("search via FTS5 returns matching observations", () => {
		repo.create(makeUserObservationData());
		repo.create(
			makeUserObservationData({
				title: "React component refactoring",
				concepts: ["react", "refactoring"],
				type: "refactor",
			}),
		);

		const results = repo.search({ query: "JWT authentication" });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].observation.title).toContain("JWT");
		expect(results[0].rank).toBeDefined();
	});

	test("search with sourceProject filter", () => {
		repo.create(makeUserObservationData({ sourceProject: "/tmp/project-a" }));
		repo.create(
			makeUserObservationData({
				title: "Other project discovery",
				sourceProject: "/tmp/project-b",
			}),
		);

		const results = repo.search({
			query: "JWT authentication",
			sourceProject: "/tmp/project-a",
		});
		expect(results).toHaveLength(1);
		expect(results[0].observation.sourceProject).toBe("/tmp/project-a");
	});

	test("search with limit", () => {
		for (let i = 0; i < 5; i++) {
			repo.create(makeUserObservationData({ title: `JWT discovery ${i}` }));
		}

		const results = repo.search({ query: "JWT", limit: 2 });
		expect(results).toHaveLength(2);
	});

	test("getIndex returns lightweight entries", () => {
		repo.create(makeUserObservationData());
		const index = repo.getIndex();
		expect(index).toHaveLength(1);
		expect(index[0].id).toBeDefined();
		expect(index[0].title).toBe("Found JWT authentication pattern");
		expect(index[0].tokenCount).toBe(150);
		expect(index[0].type).toBe("discovery");
		expect("narrative" in index[0]).toBe(false);
		expect("facts" in index[0]).toBe(false);
	});

	test("getIndex with sourceProject filter", () => {
		repo.create(makeUserObservationData({ sourceProject: "/tmp/project-a" }));
		repo.create(
			makeUserObservationData({
				title: "Other project",
				sourceProject: "/tmp/project-b",
			}),
		);

		const indexA = repo.getIndex(20, "/tmp/project-a");
		expect(indexA).toHaveLength(1);

		const indexAll = repo.getIndex();
		expect(indexAll).toHaveLength(2);
	});

	test("getIndex with limit", () => {
		for (let i = 0; i < 5; i++) {
			repo.create(makeUserObservationData({ title: `Obs ${i}` }));
		}

		const index = repo.getIndex(3);
		expect(index).toHaveLength(3);
	});

	test("delete removes observation and returns true", () => {
		const obs = repo.create(makeUserObservationData());
		const deleted = repo.delete(obs.id);
		expect(deleted).toBe(true);
		expect(repo.getById(obs.id)).toBeNull();
	});

	test("delete returns false for nonexistent id", () => {
		expect(repo.delete("nonexistent")).toBe(false);
	});

	test("delete removes from FTS5 index", () => {
		const obs = repo.create(
			makeUserObservationData({ title: "Unique searchable zebra" }),
		);
		repo.delete(obs.id);
		const results = repo.search({ query: "zebra" });
		expect(results).toHaveLength(0);
	});

	test("source_project tracking across multiple projects", () => {
		repo.create(makeUserObservationData({ sourceProject: "/project/alpha", title: "Alpha obs" }));
		repo.create(makeUserObservationData({ sourceProject: "/project/beta", title: "Beta obs" }));
		repo.create(makeUserObservationData({ sourceProject: "/project/alpha", title: "Alpha obs 2" }));

		const alphaIndex = repo.getIndex(20, "/project/alpha");
		expect(alphaIndex).toHaveLength(2);

		const betaIndex = repo.getIndex(20, "/project/beta");
		expect(betaIndex).toHaveLength(1);

		const allIndex = repo.getIndex();
		expect(allIndex).toHaveLength(3);
	});

	test("importance defaults to 3", () => {
		const obs = repo.create(makeUserObservationData());
		const fetched = repo.getById(obs.id);
		expect(fetched?.importance).toBe(3);
	});

	test("importance is stored correctly", () => {
		const obs = repo.create(makeUserObservationData({ importance: 5 }));
		const fetched = repo.getById(obs.id);
		expect(fetched?.importance).toBe(5);
	});

	test("JSON round-trip preserves arrays", () => {
		const data = makeUserObservationData({
			facts: ["fact1", "fact2", "fact3"],
			concepts: ["c1", "c2"],
			filesRead: ["a.ts", "b.ts"],
			filesModified: ["c.ts"],
		});
		const created = repo.create(data);
		const fetched = repo.getById(created.id);
		expect(fetched?.facts).toEqual(["fact1", "fact2", "fact3"]);
		expect(fetched?.concepts).toEqual(["c1", "c2"]);
		expect(fetched?.filesRead).toEqual(["a.ts", "b.ts"]);
		expect(fetched?.filesModified).toEqual(["c.ts"]);
	});
});
