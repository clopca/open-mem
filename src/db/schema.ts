// =============================================================================
// open-mem — Database Schema and FTS5 Setup
// =============================================================================

import type { Database, Migration } from "./database";

// -----------------------------------------------------------------------------
// Table Name Constants
// -----------------------------------------------------------------------------

export const TABLES = {
	SESSIONS: "sessions",
	OBSERVATIONS: "observations",
	SESSION_SUMMARIES: "session_summaries",
	PENDING_MESSAGES: "pending_messages",
	OBSERVATIONS_FTS: "observations_fts",
	SUMMARIES_FTS: "summaries_fts",
	OBSERVATION_EMBEDDINGS: "observation_embeddings",
	EMBEDDING_META: "_embedding_meta",
} as const;

// -----------------------------------------------------------------------------
// Migrations
// -----------------------------------------------------------------------------

export const MIGRATIONS: Migration[] = [
	// v1 — Core tables
	{
		version: 1,
		name: "create-core-tables",
		up: `
			-- Sessions table
			CREATE TABLE IF NOT EXISTS sessions (
				_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT UNIQUE NOT NULL,
				project_path TEXT NOT NULL,
				started_at TEXT NOT NULL DEFAULT (datetime('now')),
				ended_at TEXT,
				status TEXT NOT NULL DEFAULT 'active'
					CHECK (status IN ('active', 'idle', 'completed')),
				observation_count INTEGER NOT NULL DEFAULT 0,
				summary_id TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_sessions_project
				ON sessions(project_path);
			CREATE INDEX IF NOT EXISTS idx_sessions_status
				ON sessions(status);
			CREATE INDEX IF NOT EXISTS idx_sessions_started
				ON sessions(started_at DESC);

			-- Observations table
			CREATE TABLE IF NOT EXISTS observations (
				_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT UNIQUE NOT NULL,
				session_id TEXT NOT NULL,
				type TEXT NOT NULL
					CHECK (type IN ('decision','bugfix','feature','refactor','discovery','change')),
				title TEXT NOT NULL,
				subtitle TEXT NOT NULL DEFAULT '',
				facts TEXT NOT NULL DEFAULT '[]',
				narrative TEXT NOT NULL DEFAULT '',
				concepts TEXT NOT NULL DEFAULT '[]',
				files_read TEXT NOT NULL DEFAULT '[]',
				files_modified TEXT NOT NULL DEFAULT '[]',
				raw_tool_output TEXT NOT NULL,
				tool_name TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				token_count INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);

			CREATE INDEX IF NOT EXISTS idx_observations_session
				ON observations(session_id);
			CREATE INDEX IF NOT EXISTS idx_observations_type
				ON observations(type);
			CREATE INDEX IF NOT EXISTS idx_observations_created
				ON observations(created_at DESC);

			-- Session summaries table
			CREATE TABLE IF NOT EXISTS session_summaries (
				_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT UNIQUE NOT NULL,
				session_id TEXT NOT NULL UNIQUE,
				summary TEXT NOT NULL,
				key_decisions TEXT NOT NULL DEFAULT '[]',
				files_modified TEXT NOT NULL DEFAULT '[]',
				concepts TEXT NOT NULL DEFAULT '[]',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				token_count INTEGER NOT NULL DEFAULT 0,
				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);

			-- Pending messages (queue persistence)
			CREATE TABLE IF NOT EXISTS pending_messages (
				_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT UNIQUE NOT NULL,
				session_id TEXT NOT NULL,
				tool_name TEXT NOT NULL,
				tool_output TEXT NOT NULL,
				call_id TEXT NOT NULL,
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				status TEXT NOT NULL DEFAULT 'pending'
					CHECK (status IN ('pending','processing','completed','failed')),
				retry_count INTEGER NOT NULL DEFAULT 0,
				error TEXT,
				FOREIGN KEY (session_id) REFERENCES sessions(id)
			);

			CREATE INDEX IF NOT EXISTS idx_pending_status
				ON pending_messages(status);
			CREATE INDEX IF NOT EXISTS idx_pending_session
				ON pending_messages(session_id);
		`,
	},

	// v2 — FTS5 virtual tables and sync triggers
	{
		version: 2,
		name: "create-fts5-tables",
		up: `
			-- FTS5 for observations (title, subtitle, narrative, facts, concepts, files)
			CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
				title,
				subtitle,
				narrative,
				facts,
				concepts,
				files_read,
				files_modified,
				content=observations,
				content_rowid=_rowid,
				tokenize='porter unicode61'
			);

			-- Triggers to keep FTS5 in sync with observations table
			CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
				INSERT INTO observations_fts(
					rowid, title, subtitle, narrative, facts, concepts,
					files_read, files_modified
				)
				VALUES (
					new._rowid, new.title, new.subtitle, new.narrative,
					new.facts, new.concepts, new.files_read, new.files_modified
				);
			END;

			CREATE TRIGGER observations_ad AFTER DELETE ON observations BEGIN
				INSERT INTO observations_fts(
					observations_fts, rowid, title, subtitle, narrative,
					facts, concepts, files_read, files_modified
				)
				VALUES (
					'delete', old._rowid, old.title, old.subtitle, old.narrative,
					old.facts, old.concepts, old.files_read, old.files_modified
				);
			END;

			CREATE TRIGGER observations_au AFTER UPDATE ON observations BEGIN
				INSERT INTO observations_fts(
					observations_fts, rowid, title, subtitle, narrative,
					facts, concepts, files_read, files_modified
				)
				VALUES (
					'delete', old._rowid, old.title, old.subtitle, old.narrative,
					old.facts, old.concepts, old.files_read, old.files_modified
				);
				INSERT INTO observations_fts(
					rowid, title, subtitle, narrative, facts, concepts,
					files_read, files_modified
				)
				VALUES (
					new._rowid, new.title, new.subtitle, new.narrative,
					new.facts, new.concepts, new.files_read, new.files_modified
				);
			END;

			-- FTS5 for session summaries
			CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
				summary,
				key_decisions,
				concepts,
				content=session_summaries,
				content_rowid=_rowid,
				tokenize='porter unicode61'
			);

			CREATE TRIGGER summaries_ai AFTER INSERT ON session_summaries BEGIN
				INSERT INTO summaries_fts(rowid, summary, key_decisions, concepts)
				VALUES (new._rowid, new.summary, new.key_decisions, new.concepts);
			END;

		CREATE TRIGGER summaries_ad AFTER DELETE ON session_summaries BEGIN
			INSERT INTO summaries_fts(
				summaries_fts, rowid, summary, key_decisions, concepts
			)
			VALUES (
				'delete', old._rowid, old.summary, old.key_decisions, old.concepts
			);
		END;
	`,
	},

	// v3 — Structured summary columns
	{
		version: 3,
		name: "add-structured-summary-columns",
		up: `
			ALTER TABLE session_summaries ADD COLUMN request TEXT NOT NULL DEFAULT '';
			ALTER TABLE session_summaries ADD COLUMN investigated TEXT NOT NULL DEFAULT '';
			ALTER TABLE session_summaries ADD COLUMN learned TEXT NOT NULL DEFAULT '';
			ALTER TABLE session_summaries ADD COLUMN completed TEXT NOT NULL DEFAULT '';
			ALTER TABLE session_summaries ADD COLUMN next_steps TEXT NOT NULL DEFAULT '';
		`,
	},

	// v4 — Discovery tokens for ROI tracking
	{
		version: 4,
		name: "add-discovery-tokens",
		up: `
			ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER NOT NULL DEFAULT 0;
		`,
	},

	// v5 — Optional embedding column for vector-based semantic search
	{
		version: 5,
		name: "add-embedding-column",
		up: `
			ALTER TABLE observations ADD COLUMN embedding TEXT;
		`,
	},

	// v6 — Metadata table for embedding configuration (vec0 created separately)
	{
		version: 6,
		name: "create-embedding-meta-table",
		up: `
			CREATE TABLE IF NOT EXISTS _embedding_meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`,
	},
];

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

/** Run all migrations to bring the database schema up to date */
export function initializeSchema(
	db: Database,
	options?: { hasVectorExtension?: boolean; embeddingDimension?: number },
): void {
	db.migrate(MIGRATIONS);
	if (
		options?.hasVectorExtension &&
		options?.embeddingDimension &&
		options.embeddingDimension > 0
	) {
		initializeVec0Table(db, options.embeddingDimension);
	}
}

export function initializeVec0Table(db: Database, dimension: number): void {
	const exists = db.get<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type='table' AND name='observation_embeddings'",
	);
	if (!exists) {
		db.exec(
			`CREATE VIRTUAL TABLE observation_embeddings USING vec0(
				observation_id TEXT PRIMARY KEY,
				embedding float[${dimension}] distance_metric=cosine
			)`,
		);
	}
	db.run("INSERT OR REPLACE INTO _embedding_meta (key, value) VALUES (?, ?)", [
		"dimension",
		String(dimension),
	]);
}
