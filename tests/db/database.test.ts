// =============================================================================
// open-mem — Database Setup Tests (Task 05)
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ProcessRole } from "../../src/db/advisory-lock";
import { createDatabase, Database } from "../../src/db/database";
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
		const rows = db.all<{ version: number }>("SELECT version FROM _migrations");
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
		const rows = db.all<{ version: number }>("SELECT version FROM _migrations");
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
		const one = db.get<{ key: string; value: string }>("SELECT * FROM kv WHERE key = ?", ["a"]);
		expect(one?.value).toBe("1");
		const all = db.all<{ key: string }>("SELECT * FROM kv ORDER BY key");
		expect(all).toHaveLength(2);
		db.close();
	});

	test("test_write_helpers_use_coordinated_path", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);

		db.exec("CREATE TABLE lock_probe (id INTEGER PRIMARY KEY, value TEXT)");

		let lockCalls = 0;
		const originalWithAdvisoryWriteLock = db.withAdvisoryWriteLock.bind(db);
		(
			db as unknown as {
				withAdvisoryWriteLock: Database["withAdvisoryWriteLock"];
			}
		).withAdvisoryWriteLock = (role, fn, options) => {
			lockCalls += 1;
			return originalWithAdvisoryWriteLock(role, fn, options);
		};

		db.run("INSERT INTO lock_probe (value) VALUES (?)", ["r1"]);
		db.exec("UPDATE lock_probe SET value = 'r2' WHERE id = 1");
		db.get<{ id: number }>("INSERT INTO lock_probe (value) VALUES (?) RETURNING id", [
			"returning-get",
		]);
		db.all<{ id: number }>("UPDATE lock_probe SET value = ? WHERE value = ? RETURNING id", [
			"r3",
			"r2",
		]);
		expect(lockCalls).toBe(4);

		db.close();
	});

	test("test_database_uses_configured_process_role_for_writes", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "daemon" });

		db.exec("CREATE TABLE role_probe (id INTEGER PRIMARY KEY, value TEXT)");

		const observedRoles: string[] = [];
		const originalWithAdvisoryWriteLock = db.withAdvisoryWriteLock.bind(db);
		(
			db as unknown as {
				withAdvisoryWriteLock: Database["withAdvisoryWriteLock"];
			}
		).withAdvisoryWriteLock = (role, fn, options) => {
			observedRoles.push(role);
			return originalWithAdvisoryWriteLock(role, fn, options);
		};

		db.run("INSERT INTO role_probe (value) VALUES (?)", ["daemon-role"]);

		expect(observedRoles).toEqual(["daemon"]);
		db.close();
	});

	test("test_role_metadata_plugin", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "plugin" });

		db.exec("CREATE TABLE role_plugin_probe (id INTEGER PRIMARY KEY, value TEXT)");

		const observedRoles: string[] = [];
		const originalWithAdvisoryWriteLock = db.withAdvisoryWriteLock.bind(db);
		(
			db as unknown as {
				withAdvisoryWriteLock: Database["withAdvisoryWriteLock"];
			}
		).withAdvisoryWriteLock = (role, fn, options) => {
			observedRoles.push(role);
			return originalWithAdvisoryWriteLock(role, fn, options);
		};

		db.run("INSERT INTO role_plugin_probe (value) VALUES (?)", ["plugin-role"]);

		expect(observedRoles).toEqual(["plugin"]);
		db.close();
	});

	test("test_role_metadata_daemon_worker_maintenance", () => {
		const roles: ProcessRole[] = [
			"daemon",
			"platform-worker-claude",
			"platform-worker-cursor",
			"maintenance",
		];

		for (const role of roles) {
			const dbPath = `/tmp/open-mem-test-${randomUUID()}-${role}.db`;
			cleanupPaths.push(dbPath);
			const db = createDatabase(dbPath, { processRole: role });

			db.exec("CREATE TABLE role_matrix_probe (id INTEGER PRIMARY KEY, value TEXT)");

			const observedRoles: string[] = [];
			const originalWithAdvisoryWriteLock = db.withAdvisoryWriteLock.bind(db);
			(
				db as unknown as {
					withAdvisoryWriteLock: Database["withAdvisoryWriteLock"];
				}
			).withAdvisoryWriteLock = (capturedRole, fn, options) => {
				observedRoles.push(capturedRole);
				return originalWithAdvisoryWriteLock(capturedRole, fn, options);
			};

			db.run("INSERT INTO role_matrix_probe (value) VALUES (?)", [role]);
			expect(observedRoles).toEqual([role]);
			db.close();
		}
	});

	test("test_lock_timeout_diagnostics_include_process_role", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "maintenance" });

		const lockPath = db.writeLockPath;
		writeFileSync(
			lockPath,
			JSON.stringify({
				pid: 999999,
				role: "plugin",
				hostname: "test-host",
				acquiredAt: new Date().toISOString(),
			}),
			"utf8",
		);

		const originalError = console.error;
		const errorLogs: unknown[][] = [];
		console.error = (...args: unknown[]) => {
			errorLogs.push(args);
		};

		try {
			expect(() =>
				db.withAdvisoryWriteLock("maintenance", () => undefined, {
					timeoutMs: 25,
					retryIntervalMs: 5,
				}),
			).toThrow(/role=maintenance/);
		} finally {
			console.error = originalError;
			try {
				unlinkSync(lockPath);
			} catch {
				// lock file may already be removed
			}
			db.close();
		}

		expect(
			errorLogs.some(
				(entry) =>
					entry[0] === "[open-mem] Advisory write lock timeout" &&
					typeof entry[1] === "object" &&
					entry[1] !== null &&
					(entry[1] as { role?: unknown }).role === "maintenance",
			),
		).toBe(true);
	});

	test("test_read_helpers_avoid_unneeded_write_lock", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);

		db.exec("CREATE TABLE lock_probe_read (id INTEGER PRIMARY KEY, value TEXT)");
		db.run("INSERT INTO lock_probe_read (value) VALUES (?)", ["seed"]);

		let lockCalls = 0;
		const originalWithAdvisoryWriteLock = db.withAdvisoryWriteLock.bind(db);
		(
			db as unknown as {
				withAdvisoryWriteLock: Database["withAdvisoryWriteLock"];
			}
		).withAdvisoryWriteLock = (role, fn, options) => {
			lockCalls += 1;
			return originalWithAdvisoryWriteLock(role, fn, options);
		};

		db.get("SELECT id FROM lock_probe_read WHERE value = ?", ["seed"]);
		db.all("SELECT value FROM lock_probe_read ORDER BY id");

		expect(lockCalls).toBe(0);
		db.close();
	});

	test("transaction uses BEGIN IMMEDIATE strategy", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);

		db.exec("CREATE TABLE txn_probe (id INTEGER PRIMARY KEY, value TEXT)");

		type WrappedTransaction<T> = (() => T) & { immediate?: () => T };
		type RawDatabase = {
			transaction: <T>(fn: () => T) => WrappedTransaction<T>;
		};

		const raw = db.raw as unknown as RawDatabase;
		const originalTransaction = raw.transaction;
		let immediateCalls = 0;

		raw.transaction = <T>(fn: () => T): WrappedTransaction<T> => {
			const wrapped = (() => fn()) as WrappedTransaction<T>;
			wrapped.immediate = () => {
				immediateCalls += 1;
				return fn();
			};
			return wrapped;
		};

		try {
			db.transaction(() => {
				db.run("INSERT INTO txn_probe (value) VALUES (?)", ["x"]);
			});
		} finally {
			raw.transaction = originalTransaction;
		}

		expect(immediateCalls).toBe(1);
		expect(db.all<{ id: number }>("SELECT id FROM txn_probe")).toHaveLength(1);
		db.close();
	});

	test("test_begin_immediate_under_contention", async () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		const markerPath = `/tmp/open-mem-test-${randomUUID()}.contention.json`;
		cleanupPaths.push(dbPath, markerPath);

		const db = createDatabase(dbPath);
		db.exec("CREATE TABLE txn_contention (id INTEGER PRIMARY KEY, value TEXT)");

		const holdMs = 250;
		const databaseModulePath = resolve(import.meta.dir, "../../src/db/database.ts");
		const script = `
import { createDatabase } from ${JSON.stringify(databaseModulePath)};
import { writeFileSync } from "node:fs";

const db = createDatabase(${JSON.stringify(dbPath)});
const startedAt = Date.now();

db.transaction(() => {
  db.run("INSERT INTO txn_contention (value) VALUES (?)", ["writer-2"]);
});

writeFileSync(
  ${JSON.stringify(markerPath)},
  JSON.stringify({ waitMs: Date.now() - startedAt }),
  "utf8",
);

db.close();
`;

		const child = Bun.spawn([process.execPath, "--eval", script], {
			stderr: "pipe",
			stdout: "pipe",
		});

		db.transaction(() => {
			db.run("INSERT INTO txn_contention (value) VALUES (?)", ["writer-1"]);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, holdMs);
		});

		const exitCode = await child.exited;
		const stderrText = child.stderr ? await new Response(child.stderr).text() : "";

		expect(exitCode).toBe(0);
		expect(stderrText).not.toContain("Unhandled");

		const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { waitMs: number };
		expect(marker.waitMs).toBeGreaterThanOrEqual(holdMs - 40);

		const rows = db.all<{ value: string }>("SELECT value FROM txn_contention ORDER BY id");
		expect(rows.map((row) => row.value)).toEqual(["writer-1", "writer-2"]);

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

	test("transaction write operations do not retry on transient errors", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath);
		db.exec("CREATE TABLE retry_guard_probe (id INTEGER PRIMARY KEY, value TEXT)");

		type RawQueryDatabase = {
			query: (sql: string) => {
				run: (...params: unknown[]) => unknown;
				get: (...params: unknown[]) => unknown;
				all: (...params: unknown[]) => unknown;
			};
		};

		const raw = db.raw as unknown as RawQueryDatabase;
		const originalQuery = raw.query.bind(raw);
		let insertAttempts = 0;
		raw.query = (sql: string) => {
			const stmt = originalQuery(sql);
			if (!sql.includes("INSERT INTO retry_guard_probe")) {
				return stmt;
			}

			return {
				...stmt,
				run: (..._params: unknown[]) => {
					insertAttempts += 1;
					const error = new Error("simulated busy in transaction") as Error & { code: string };
					error.code = "SQLITE_BUSY";
					throw error;
				},
			};
		};

		try {
			expect(() =>
				db.transaction(() => {
					db.run("INSERT INTO retry_guard_probe (value) VALUES (?)", ["x"]);
				}),
			).toThrow("simulated busy in transaction");
			const rows = db.all<{ id: number }>("SELECT id FROM retry_guard_probe");
			expect(rows).toHaveLength(0);
			expect(insertAttempts).toBe(1);
		} finally {
			raw.query = originalQuery;
			db.close();
		}
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

	test("test_configure_failure_no_file_deletion", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);

		const setupDb = createDatabase(dbPath);
		setupDb.exec("CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, value TEXT)");
		setupDb.run("INSERT INTO t (value) VALUES (?)", ["seed"]);
		setupDb.close();

		for (const suffix of ["-wal", "-shm"]) {
			const filePath = dbPath + suffix;
			if (!existsSync(filePath)) {
				writeFileSync(filePath, `${suffix}-seed`);
			}
		}

		const before = ["", "-wal", "-shm"].map((suffix) => {
			const filePath = dbPath + suffix;
			return { filePath, size: statSync(filePath).size };
		});

		const originalApplyPragmas = (Database.prototype as unknown as { applyPragmas: () => void })
			.applyPragmas;
		(Database.prototype as unknown as { applyPragmas: () => void }).applyPragmas = () => {
			const error = new Error("simulated pragma failure") as Error & { code: string };
			error.code = "SQLITE_IOERR";
			throw error;
		};

		try {
			expect(() => createDatabase(dbPath)).toThrow(
				"Database startup failed during applyPragmas (fail-safe, non-destructive): [SQLITE_IOERR] simulated pragma failure",
			);
		} finally {
			(Database.prototype as unknown as { applyPragmas: () => void }).applyPragmas =
				originalApplyPragmas;
		}

		for (const file of before) {
			expect(existsSync(file.filePath)).toBe(true);
			expect(statSync(file.filePath).size).toBe(file.size);
		}
	});

	test("test_no_destructive_recovery_branch", () => {
		expect(
			(Database.prototype as unknown as { deleteSidecarFiles?: () => void }).deleteSidecarFiles,
		).toBeUndefined();
		expect(
			(Database.prototype as unknown as { deleteDatabaseFiles?: () => void }).deleteDatabaseFiles,
		).toBeUndefined();
	});

	test("test_checkpoint_operation_non_destructive", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "maintenance" });

		db.exec("CREATE TABLE checkpoint_probe (id INTEGER PRIMARY KEY, value TEXT)");
		db.run("INSERT INTO checkpoint_probe (value) VALUES (?)", ["x"]);

		const result = db.checkpointWal("PASSIVE");

		expect(result.mode).toBe("PASSIVE");
		expect(Number.isInteger(result.busy)).toBe(true);
		expect(Number.isInteger(result.logFrames)).toBe(true);
		expect(Number.isInteger(result.checkpointedFrames)).toBe(true);
		expect(existsSync(dbPath)).toBe(true);
		expect(existsSync(`${dbPath}-wal`)).toBe(true);
		expect(existsSync(`${dbPath}-shm`)).toBe(true);
		db.close();
	});

	test("test_integrity_check_reports_status", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "maintenance" });

		db.exec("CREATE TABLE integrity_probe (id INTEGER PRIMARY KEY, value TEXT)");
		db.run("INSERT INTO integrity_probe (value) VALUES (?)", ["ok"]);

		const result = db.integrityCheck(5);
		expect(result.ok).toBe(true);
		expect(result.maxErrors).toBe(5);
		expect(result.messages).toContain("ok");
		db.close();
	});

	test("test_integrity_check_reports_status_corrupt_simulation", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "maintenance" });

		type RawQueryDatabase = {
			query: (sql: string) => { get: () => unknown; all: () => unknown[] };
		};

		const raw = db.raw as unknown as RawQueryDatabase;
		const originalQuery = raw.query.bind(raw);
		raw.query = (sql: string) => {
			if (sql.startsWith("PRAGMA integrity_check")) {
				return {
					get: () => ({ integrity_check: "row 1 missing from index" }),
					all: () => [{ integrity_check: "row 1 missing from index" }],
				};
			}
			return originalQuery(sql);
		};

		try {
			const result = db.integrityCheck(3);
			expect(result.ok).toBe(false);
			expect(result.maxErrors).toBe(3);
			expect(result.messages).toEqual(["row 1 missing from index"]);
		} finally {
			raw.query = originalQuery;
			db.close();
		}
	});

	test("integrity helper surfaces SQLite failures", () => {
		const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
		cleanupPaths.push(dbPath);
		const db = createDatabase(dbPath, { processRole: "maintenance" });

		type RawQueryDatabase = {
			query: (sql: string) => { get: () => unknown; all: () => unknown[] };
		};

		const raw = db.raw as unknown as RawQueryDatabase;
		const originalQuery = raw.query.bind(raw);
		raw.query = (sql: string) => {
			if (sql.startsWith("PRAGMA integrity_check")) {
				const error = new Error("simulated integrity failure") as Error & { code: string };
				error.code = "SQLITE_BUSY";
				throw error;
			}
			return originalQuery(sql);
		};

		try {
			expect(() => db.integrityCheck()).toThrow("simulated integrity failure");
		} finally {
			raw.query = originalQuery;
			db.close();
		}
	});
});
