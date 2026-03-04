// =============================================================================
// open-mem — SQLite Database Connection Manager
// =============================================================================

import { Database as BunDatabase, type SQLQueryBindings } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";
import {
	type AcquireWriteLockOptions,
	AdvisoryLockTimeoutError,
	DEFAULT_WRITE_LOCK_ROLE,
	getAdvisoryWriteLockPath,
	type ProcessRole,
	withWriteLock,
} from "./advisory-lock";

/** Param array accepted by query helpers */
type Params = SQLQueryBindings[];

// -----------------------------------------------------------------------------
// Retry Configuration for Transient SQLite Errors
// -----------------------------------------------------------------------------

/** SQLite error codes that are safe to retry (transient I/O / locking issues) */
const RETRYABLE_CODES = new Set([
	"SQLITE_BUSY",
	"SQLITE_LOCKED",
	"SQLITE_IOERR",
	"SQLITE_IOERR_VNODE",
	"SQLITE_IOERR_READ",
	"SQLITE_IOERR_WRITE",
	"SQLITE_IOERR_SHORT_READ",
	"SQLITE_IOERR_FSYNC",
	"SQLITE_PROTOCOL",
]);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 50;
const WRITE_INTENT_LEADING_TOKENS = new Set([
	"INSERT",
	"UPDATE",
	"DELETE",
	"REPLACE",
	"CREATE",
	"ALTER",
	"DROP",
	"VACUUM",
	"REINDEX",
	"ANALYZE",
	"ATTACH",
	"DETACH",
]);

const MUTATING_PRAGMA_CALLS = new Set([
	"WAL_CHECKPOINT",
	"OPTIMIZE",
	"INCREMENTAL_VACUUM",
	"SHRINK_MEMORY",
]);

const LEADING_SQL_NOISE = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/;

function stripLeadingSqlNoise(sql: string): string {
	let normalized = sql;
	for (;;) {
		const next = normalized.replace(LEADING_SQL_NOISE, "");
		if (next === normalized) {
			return normalized.trimStart();
		}
		normalized = next;
	}
}

function splitSqlStatements(sql: string): string[] {
	const statements: string[] = [];
	let start = 0;
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let inBacktickQuote = false;
	let inBracketQuote = false;
	let inLineComment = false;
	let inBlockComment = false;

	for (let index = 0; index < sql.length; index += 1) {
		const char = sql[index];
		const next = sql[index + 1];

		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
			}
			continue;
		}

		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				index += 1;
			}
			continue;
		}

		if (inSingleQuote) {
			if (char === "'") {
				if (next === "'") {
					index += 1;
				} else {
					inSingleQuote = false;
				}
			}
			continue;
		}

		if (inDoubleQuote) {
			if (char === '"') {
				if (next === '"') {
					index += 1;
				} else {
					inDoubleQuote = false;
				}
			}
			continue;
		}

		if (inBacktickQuote) {
			if (char === "`") {
				inBacktickQuote = false;
			}
			continue;
		}

		if (inBracketQuote) {
			if (char === "]") {
				inBracketQuote = false;
			}
			continue;
		}

		if (char === "-" && next === "-") {
			inLineComment = true;
			index += 1;
			continue;
		}

		if (char === "/" && next === "*") {
			inBlockComment = true;
			index += 1;
			continue;
		}

		if (char === "'") {
			inSingleQuote = true;
			continue;
		}

		if (char === '"') {
			inDoubleQuote = true;
			continue;
		}

		if (char === "`") {
			inBacktickQuote = true;
			continue;
		}

		if (char === "[") {
			inBracketQuote = true;
			continue;
		}

		if (char === ";") {
			const statement = sql.slice(start, index).trim();
			if (statement.length > 0) {
				statements.push(statement);
			}
			start = index + 1;
		}
	}

	const trailingStatement = sql.slice(start).trim();
	if (trailingStatement.length > 0) {
		statements.push(trailingStatement);
	}

	return statements;
}

function hasMutatingStatementIntent(sql: string): boolean {
	const normalized = stripLeadingSqlNoise(sql);
	if (!normalized) return false;

	const upper = normalized.toUpperCase();
	if (/\bRETURNING\b/.test(upper)) {
		return true;
	}

	if (upper.startsWith("PRAGMA")) {
		if (/^PRAGMA\b[\s\S]*=/.test(upper)) {
			return true;
		}

		const pragmaName = /^PRAGMA\s+(?:[A-Z0-9_]+\.)?([A-Z0-9_]+)/.exec(upper)?.[1];
		if (!pragmaName) {
			return false;
		}

		return MUTATING_PRAGMA_CALLS.has(pragmaName);
	}

	const leadingToken = /^[A-Z]+/.exec(upper)?.[0];
	if (!leadingToken) return false;

	if (WRITE_INTENT_LEADING_TOKENS.has(leadingToken)) {
		return true;
	}

	if (leadingToken === "WITH") {
		return /\b(INSERT|UPDATE|DELETE|REPLACE)\b/.test(upper);
	}

	return false;
}

function hasMutatingIntent(sql: string): boolean {
	const statements = splitSqlStatements(sql);
	if (statements.length === 0) {
		return false;
	}

	for (const statement of statements) {
		if (hasMutatingStatementIntent(statement)) {
			return true;
		}
	}

	return false;
}

type ConfigureStage = "applyPragmas" | "loadExtensions";

export interface DatabaseOptions {
	processRole?: ProcessRole;
}

export type WalCheckpointMode = "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE";
const WAL_CHECKPOINT_MODES = new Set<WalCheckpointMode>(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]);

export interface WalCheckpointResult {
	mode: WalCheckpointMode;
	busy: number;
	logFrames: number;
	checkpointedFrames: number;
}

export interface IntegrityCheckResult {
	ok: boolean;
	messages: string[];
	maxErrors: number;
}

function getSqliteErrorDetails(error: unknown): { code: string; message: string } {
	if (error instanceof Error) {
		const maybeCode = (error as Error & { code?: unknown }).code;
		const sqliteCode = typeof maybeCode === "string" ? maybeCode : "UNKNOWN";
		return { code: sqliteCode, message: error.message };
	}

	return { code: "UNKNOWN", message: String(error) };
}

/** Returns true when the error is a transient SQLite problem worth retrying */
function isRetryable(err: unknown): boolean {
	if (err && typeof err === "object" && "code" in err) {
		const code = (err as { code: string }).code;
		return RETRYABLE_CODES.has(code);
	}
	return false;
}

// -----------------------------------------------------------------------------
// Migration Types
// -----------------------------------------------------------------------------

/** A database migration with version, name, and SQL to apply. */
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
	private dbPath: string;
	private advisoryWriteLockPath: string;
	private processRole: ProcessRole;
	private transactionDepth = 0;
	private _hasVectorExtension = false;

	static enableExtensionSupport(): boolean {
		const customPaths = [
			"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
			"/usr/local/opt/sqlite/lib/libsqlite3.dylib",
		];
		for (const p of customPaths) {
			try {
				if (existsSync(p)) {
					BunDatabase.setCustomSQLite(p);
					return true;
				}
			} catch {
				return false;
			}
		}
		return false;
	}

	constructor(dbPath: string, options: DatabaseOptions = {}) {
		this.dbPath = dbPath;
		this.processRole = options.processRole ?? DEFAULT_WRITE_LOCK_ROLE;
		this.advisoryWriteLockPath = getAdvisoryWriteLockPath(dbPath);
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
		this.runConfigureStage("applyPragmas", () => this.applyPragmas());
		this.runConfigureStage("loadExtensions", () => this.loadExtensions());
	}

	private runConfigureStage(stage: ConfigureStage, operation: () => void): void {
		try {
			operation();
		} catch (error) {
			this.throwConfigureFailure(stage, error);
		}
	}

	private throwConfigureFailure(stage: ConfigureStage, error: unknown): never {
		const details = getSqliteErrorDetails(error);
		try {
			this.db.close();
		} catch {
			// Preserve original configure failure details
		}

		console.error("[open-mem] Database configure failed (non-destructive fail-safe)", {
			stage,
			dbPath: this.dbPath,
			sqliteCode: details.code,
			sqliteMessage: details.message,
			action: "startup-abort",
			deletionAttempted: false,
		});

		const startupError = new Error(
			`Database startup failed during ${stage} (fail-safe, non-destructive): [${details.code}] ${details.message}`,
		);
		throw startupError;
	}

	private applyPragmas(): void {
		// WAL mode for concurrent read/write performance
		this.db.exec("PRAGMA journal_mode = WAL");
		// NORMAL sync is safe with WAL and much faster than FULL
		this.db.exec("PRAGMA synchronous = NORMAL");
		// Enforce foreign key constraints
		this.db.exec("PRAGMA foreign_keys = ON");
		// Prevent "database is locked" errors during concurrent access
		this.db.exec("PRAGMA busy_timeout = 5000");
	}

	private loadExtensions(): void {
		try {
			sqliteVec.load(this.db);
			this._hasVectorExtension = true;
		} catch (error) {
			const details = getSqliteErrorDetails(error);
			console.warn("[open-mem] SQLite extension load skipped", {
				stage: "loadExtensions",
				dbPath: this.dbPath,
				sqliteCode: details.code,
				sqliteMessage: details.message,
				action: "continue-without-extension",
			});
			this._hasVectorExtension = false;
		}
	}

	public get hasVectorExtension(): boolean {
		return this._hasVectorExtension;
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
		this.withAdvisoryWriteLock(this.processRole, () => {
			this.ensureMigrationTable();

			const applied = this.withRetry("migrate.applied_versions", () => {
				return this.db.query("SELECT version FROM _migrations ORDER BY version").all() as {
					version: number;
				}[];
			});
			const appliedVersions = new Set(applied.map((migration) => migration.version));

			const pending = migrations
				.filter((migration) => !appliedVersions.has(migration.version))
				.sort((left, right) => left.version - right.version);

			for (const migration of pending) {
				this.transaction(() => {
					this.exec(migration.up);
					this.run("INSERT INTO _migrations (version, name) VALUES ($version, $name)", [
						{
							$version: migration.version,
							$name: migration.name,
						},
					]);
				});
			}
		});
	}

	// ---------------------------------------------------------------------------
	// Query Helpers (with automatic retry for transient SQLite errors)
	// ---------------------------------------------------------------------------

	/**
	 * Retry a synchronous database operation with exponential backoff.
	 * Transient errors (SQLITE_BUSY, SQLITE_IOERR_VNODE, etc.) are retried
	 * up to MAX_RETRIES times; all other errors propagate immediately.
	 */
	private withRetry<T>(operationName: string, operation: () => T): T {
		const maxRetries = this.transactionDepth > 0 ? 0 : MAX_RETRIES;
		let lastError: unknown;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return operation();
			} catch (err) {
				lastError = err;
				if (!isRetryable(err) || attempt === maxRetries) {
					throw err;
				}
				// Synchronous busy-wait (Bun SQLite is synchronous, so async sleep
				// would break transaction semantics). Use Atomics.wait for a true
				// thread sleep without spinning.
				const delayMs = BASE_DELAY_MS * 2 ** attempt + Math.random() * BASE_DELAY_MS;
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
				const details = getSqliteErrorDetails(err);
				console.warn("[open-mem] Retrying after transient SQLite error", {
					attempt: attempt + 1,
					maxRetries,
					operation: operationName,
					role: this.processRole,
					dbPath: this.dbPath,
					sqliteCode: details.code,
					sqliteMessage: details.message,
				});
			}
		}
		throw lastError; // unreachable, but satisfies TS
	}

	/** Execute a write statement (INSERT / UPDATE / DELETE) with optional params */
	public run(sql: string, params?: Params): void {
		this.withAdvisoryWriteLock(this.processRole, () => {
			this.withRetry("run", () => {
				const stmt = this.db.query(sql);
				if (params) {
					stmt.run(...params);
				} else {
					stmt.run();
				}
			});
		});
	}

	/** Fetch a single row, or null if not found */
	public get<T>(sql: string, params?: Params): T | null {
		const operation = () => {
			const stmt = this.db.query(sql);
			return (params ? stmt.get(...params) : stmt.get()) as T | null;
		};

		if (hasMutatingIntent(sql)) {
			return this.withAdvisoryWriteLock(this.processRole, () => this.withRetry("get", operation));
		}

		return this.withRetry("get", operation);
	}

	/** Fetch all matching rows */
	public all<T>(sql: string, params?: Params): T[] {
		const operation = () => {
			const stmt = this.db.query(sql);
			return (params ? stmt.all(...params) : stmt.all()) as T[];
		};

		if (hasMutatingIntent(sql)) {
			return this.withAdvisoryWriteLock(this.processRole, () => this.withRetry("all", operation));
		}

		return this.withRetry("all", operation);
	}

	/** Execute raw SQL (multiple statements, no params) */
	public exec(sql: string): void {
		const operation = () => this.withRetry("exec", () => this.db.exec(sql));
		if (hasMutatingIntent(sql)) {
			this.withAdvisoryWriteLock(this.processRole, operation);
			return;
		}

		operation();
	}

	/** Wrap a function in a SQLite transaction — auto-commits or rolls back */
	public transaction<T>(fn: () => T): T {
		return this.withAdvisoryWriteLock(this.processRole, () => {
			if (this.transactionDepth > 0) {
				return fn();
			}

			const wrapped = this.db.transaction(fn) as (() => T) & {
				immediate?: () => T;
			};
			if (typeof wrapped.immediate === "function") {
				this.transactionDepth += 1;
				try {
					return wrapped.immediate();
				} finally {
					this.transactionDepth -= 1;
				}
			}

			this.db.exec("BEGIN IMMEDIATE");
			this.transactionDepth += 1;
			try {
				const result = fn();
				this.db.exec("COMMIT");
				return result;
			} catch (error) {
				try {
					this.db.exec("ROLLBACK");
				} catch {
					// Preserve original transactional failure; rollback is best-effort.
				}
				throw error;
			} finally {
				this.transactionDepth -= 1;
			}
		});
	}

	/** Advisory write lock path associated with this database path. */
	public get writeLockPath(): string {
		return this.advisoryWriteLockPath;
	}

	/**
	 * Execute a callback under the cross-process advisory write lock.
	 */
	public withAdvisoryWriteLock<T>(
		role: ProcessRole,
		fn: () => T,
		options?: Omit<AcquireWriteLockOptions, "role">,
	): T {
		try {
			return withWriteLock(this.advisoryWriteLockPath, { ...options, role }, fn);
		} catch (error) {
			if (error instanceof AdvisoryLockTimeoutError) {
				console.error("[open-mem] Advisory write lock timeout", {
					role,
					dbPath: this.dbPath,
					lockPath: error.lockPath,
					waitDurationMs: error.waitDurationMs,
					owner: error.owner,
				});
			}
			throw error;
		}
	}

	public checkpointWal(mode: WalCheckpointMode = "PASSIVE"): WalCheckpointResult {
		const normalizedMode = typeof mode === "string" ? mode.toUpperCase() : "";
		if (!WAL_CHECKPOINT_MODES.has(normalizedMode as WalCheckpointMode)) {
			throw new Error(`Invalid wal_checkpoint mode: ${String(mode)}`);
		}

		return this.withAdvisoryWriteLock(this.processRole, () => {
			return this.withRetry("maintenance.wal_checkpoint", () => {
				const row = this.db.query(`PRAGMA wal_checkpoint(${normalizedMode})`).get() as {
					busy?: number;
					log?: number;
					checkpointed?: number;
				} | null;

				if (!row) {
					throw new Error("wal_checkpoint returned no result row");
				}

				return {
					mode: normalizedMode as WalCheckpointMode,
					busy: row.busy ?? 0,
					logFrames: row.log ?? 0,
					checkpointedFrames: row.checkpointed ?? 0,
				};
			});
		});
	}

	public integrityCheck(maxErrors = 1): IntegrityCheckResult {
		const normalizedMaxErrors = Number.isFinite(maxErrors) ? Math.max(1, Math.floor(maxErrors)) : 1;

		return this.withRetry("maintenance.integrity_check", () => {
			const rows = this.db.query(`PRAGMA integrity_check(${normalizedMaxErrors})`).all() as Array<
				Record<string, unknown>
			>;

			if (rows.length === 0) {
				throw new Error("integrity_check returned no result rows");
			}

			const messages = rows
				.map((row) => Object.values(row).find((value) => typeof value === "string"))
				.filter((value): value is string => typeof value === "string")
				.map((value) => value.trim())
				.filter((value) => value.length > 0);

			if (messages.length === 0) {
				throw new Error("integrity_check returned no diagnostic messages");
			}

			return {
				ok: messages.length === 1 && messages[0].toLowerCase() === "ok",
				messages,
				maxErrors: normalizedMaxErrors,
			};
		});
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
export function createDatabase(dbPath: string, options?: DatabaseOptions): Database {
	return new Database(dbPath, options);
}
