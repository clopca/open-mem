// =============================================================================
// open-mem — Database Setup Tests (Task 05)
// =============================================================================

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../src/db/database";
import { cleanupTestDb } from "./helpers";

let cleanupPaths: string[] = [];

afterEach(() => {
	for (const p of cleanupPaths) cleanupTestDb(p);
	cleanupPaths = [];
});

describe("Database Setup", () => {
	test("creates file at specified path", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		expect(existsSync(dbPath)).toBe(true);
		db.close();
	});

	test("creates directory if missing", () => {
		const dir = `/tmp/open-mem-test-${randomUUID()}`;
		const dbPath = `${dir}/nested/memory.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		expect(existsSync(dbPath)).toBe(true);
		db.close();
	});

	test("WAL mode is enabled", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		const row = db.get<{ journal_mode: string }>("PRAGMA journal_mode");
		expect(row?.journal_mode).toBe("wal");
		db.close();
	});

	test("foreign keys are enabled", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		const row = db.get<{ foreign_keys: number }>("PRAGMA foreign_keys");
		expect(row?.foreign_keys).toBe(1);
		db.close();
	});

	test("migration runs and tracks", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		db.migrate([
			{
				version: 1,
				name: "create-test",
				up: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
			},
		]);
		const rows = db.all<{ version: number }>(
			"SELECT version FROM _migrations",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].version).toBe(1);
		db.close();
	});

	test("migration skips already applied", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		const migration = {
			version: 1,
			name: "create-test",
			up: "CREATE TABLE test_table (id INTEGER PRIMARY KEY)",
		};
		db.migrate([migration]);
		db.migrate([migration]); // run again
		const rows = db.all<{ version: number }>(
			"SELECT version FROM _migrations",
		);
		expect(rows).toHaveLength(1);
		db.close();
	});

	test("migrations run in version order", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		// Pass migrations out of order
		db.migrate([
			{
				version: 3,
				name: "third",
				up: "CREATE TABLE t3 (id INTEGER PRIMARY KEY)",
			},
			{
				version: 1,
				name: "first",
				up: "CREATE TABLE t1 (id INTEGER PRIMARY KEY)",
			},
			{
				version: 2,
				name: "second",
				up: "CREATE TABLE t2 (id INTEGER PRIMARY KEY)",
			},
		]);
		const rows = db.all<{ version: number; name: string }>(
			"SELECT version, name FROM _migrations ORDER BY version",
		);
		expect(rows).toHaveLength(3);
		expect(rows[0].name).toBe("first");
		expect(rows[1].name).toBe("second");
		expect(rows[2].name).toBe("third");
		db.close();
	});

	test("query helpers work (run, get, all)", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT)");
		db.run("INSERT INTO kv (key, value) VALUES (?, ?)", ["a", "1"]);
		db.run("INSERT INTO kv (key, value) VALUES (?, ?)", ["b", "2"]);
		const one = db.get<{ key: string; value: string }>(
			"SELECT * FROM kv WHERE key = ?",
			["a"],
		);
		expect(one?.value).toBe("1");
		const all = db.all<{ key: string }>("SELECT * FROM kv ORDER BY key");
		expect(all).toHaveLength(2);
		db.close();
	});

	test("transaction commits on success", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		db.exec("CREATE TABLE nums (n INTEGER)");
		db.transaction(() => {
			db.run("INSERT INTO nums (n) VALUES (?)", [1]);
			db.run("INSERT INTO nums (n) VALUES (?)", [2]);
		});
		const rows = db.all<{ n: number }>("SELECT * FROM nums");
		expect(rows).toHaveLength(2);
		db.close();
	});

	test("transaction rolls back on error", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		db.exec("CREATE TABLE nums (n INTEGER)");
		try {
			db.transaction(() => {
				db.run("INSERT INTO nums (n) VALUES (?)", [1]);
				throw new Error("rollback!");
			});
		} catch {
			// expected
		}
		const rows = db.all<{ n: number }>("SELECT * FROM nums");
		expect(rows).toHaveLength(0);
		db.close();
	});

	test("close shuts down cleanly", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		expect(db.isOpen).toBe(true);
		db.close();
		expect(db.isOpen).toBe(false);
	});
});
