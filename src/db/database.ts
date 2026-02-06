// =============================================================================
// open-mem — SQLite Database Connection Manager
// =============================================================================

import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync } from "node:fs";

/** Param array accepted by query helpers */
type Params = SQLQueryBindings[];

// -----------------------------------------------------------------------------
// Migration Types
// -----------------------------------------------------------------------------

export interface Migration {
	version: number;
	name: string;
	up: string; // SQL to apply (forward-only, no down migrations)
}

// -----------------------------------------------------------------------------
// Database Class
// -----------------------------------------------------------------------------

/**
 * Manages the SQLite connection lifecycle: opening, configuring (WAL mode,
 * foreign keys, busy timeout), running migrations, and exposing typed
 * query helpers. Wraps bun:sqlite.
 */
export class Database {
	private db: BunDatabase;

	constructor(dbPath: string) {
		this.db = this.open(dbPath);
		this.configure();
	}

	// ---------------------------------------------------------------------------
	// Connection Setup
	// ---------------------------------------------------------------------------

	private open(dbPath: string): BunDatabase {
		// Ensure parent directory exists
		const lastSlash = dbPath.lastIndexOf("/");
		if (lastSlash > 0) {
			const dir = dbPath.substring(0, lastSlash);
			mkdirSync(dir, { recursive: true });
		}

		return new BunDatabase(dbPath, { create: true });
	}

	private configure(): void {
		// WAL mode for concurrent read/write performance
		this.db.exec("PRAGMA journal_mode = WAL");
		// NORMAL sync is safe with WAL and much faster than FULL
		this.db.exec("PRAGMA synchronous = NORMAL");
		// Enforce foreign key constraints
		this.db.exec("PRAGMA foreign_keys = ON");
		// Prevent "database is locked" errors during concurrent access
		this.db.exec("PRAGMA busy_timeout = 5000");
	}

	// ---------------------------------------------------------------------------
	// Migration System
	// ---------------------------------------------------------------------------

	private ensureMigrationTable(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS _migrations (
				version INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at TEXT NOT NULL DEFAULT (datetime('now'))
			)
		`);
	}

	/**
	 * Run pending migrations in version order. Already-applied migrations
	 * are skipped. Each migration runs inside a transaction.
	 */
	public migrate(migrations: Migration[]): void {
		this.ensureMigrationTable();

		const applied = this.db
			.query("SELECT version FROM _migrations ORDER BY version")
			.all() as { version: number }[];
		const appliedVersions = new Set(applied.map((m) => m.version));

		const pending = migrations
			.filter((m) => !appliedVersions.has(m.version))
			.sort((a, b) => a.version - b.version);

		for (const migration of pending) {
			this.db.transaction(() => {
				this.db.exec(migration.up);
				this.db
					.query(
						"INSERT INTO _migrations (version, name) VALUES ($version, $name)",
					)
					.run({ $version: migration.version, $name: migration.name });
			})();
		}
	}

	// ---------------------------------------------------------------------------
	// Query Helpers
	// ---------------------------------------------------------------------------

	/** Execute a write statement (INSERT / UPDATE / DELETE) with optional params */
	public run(sql: string, params?: Params): void {
		const stmt = this.db.query(sql);
		if (params) {
			stmt.run(...params);
		} else {
			stmt.run();
		}
	}

	/** Fetch a single row, or null if not found */
	public get<T>(sql: string, params?: Params): T | null {
		const stmt = this.db.query(sql);
		return (params ? stmt.get(...params) : stmt.get()) as T | null;
	}

	/** Fetch all matching rows */
	public all<T>(sql: string, params?: Params): T[] {
		const stmt = this.db.query(sql);
		return (params ? stmt.all(...params) : stmt.all()) as T[];
	}

	/** Execute raw SQL (multiple statements, no params) */
	public exec(sql: string): void {
		this.db.exec(sql);
	}

	/** Wrap a function in a SQLite transaction — auto-commits or rolls back */
	public transaction<T>(fn: () => T): T {
		return this.db.transaction(fn)();
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/** Close the database connection */
	public close(): void {
		this.db.close();
	}

	/** Check whether the connection is still usable */
	public get isOpen(): boolean {
		try {
			this.db.query("SELECT 1").get();
			return true;
		} catch {
			return false;
		}
	}

	/** Access the underlying bun:sqlite instance for advanced use */
	public get raw(): BunDatabase {
		return this.db;
	}
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

/** Create and configure a Database instance at the given path */
export function createDatabase(dbPath: string): Database {
	return new Database(dbPath);
}
