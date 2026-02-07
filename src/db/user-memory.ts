// =============================================================================
// open-mem — User-Level Cross-Project Memory Database
// =============================================================================

import { randomUUID } from "node:crypto";
import type { ObservationIndex, ObservationType } from "../types";
import { createDatabase, type Database, type Migration } from "./database";

// -----------------------------------------------------------------------------
// User Observation Types
// -----------------------------------------------------------------------------

export interface UserObservation {
	id: string;
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
	toolName: string;
	createdAt: string;
	tokenCount: number;
	importance: number;
	sourceProject: string;
}

interface UserObservationRow {
	id: string;
	type: string;
	title: string;
	subtitle: string;
	facts: string;
	narrative: string;
	concepts: string;
	files_read: string;
	files_modified: string;
	tool_name: string;
	created_at: string;
	token_count: number;
	importance: number;
	source_project: string;
}

interface UserObservationIndexRow {
	id: string;
	type: string;
	title: string;
	token_count: number;
	created_at: string;
	importance: number;
	source_project: string;
}

interface UserObservationSearchRow extends UserObservationRow {
	rank: number;
}

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

const USER_MIGRATIONS: Migration[] = [
	{
		version: 1,
		name: "create-user-observations",
		up: `
			CREATE TABLE IF NOT EXISTS user_observations (
				_rowid INTEGER PRIMARY KEY AUTOINCREMENT,
				id TEXT UNIQUE NOT NULL,
				type TEXT NOT NULL CHECK (type IN ('decision','bugfix','feature','refactor','discovery','change')),
				title TEXT NOT NULL,
				subtitle TEXT NOT NULL DEFAULT '',
				facts TEXT NOT NULL DEFAULT '[]',
				narrative TEXT NOT NULL DEFAULT '',
				concepts TEXT NOT NULL DEFAULT '[]',
				files_read TEXT NOT NULL DEFAULT '[]',
				files_modified TEXT NOT NULL DEFAULT '[]',
				tool_name TEXT NOT NULL DEFAULT '',
				created_at TEXT NOT NULL DEFAULT (datetime('now')),
				token_count INTEGER NOT NULL DEFAULT 0,
				importance INTEGER NOT NULL DEFAULT 3,
				source_project TEXT NOT NULL DEFAULT ''
			);

			CREATE INDEX IF NOT EXISTS idx_user_obs_created
				ON user_observations(created_at DESC);
			CREATE INDEX IF NOT EXISTS idx_user_obs_type
				ON user_observations(type);
			CREATE INDEX IF NOT EXISTS idx_user_obs_source_project
				ON user_observations(source_project);

			CREATE VIRTUAL TABLE IF NOT EXISTS user_observations_fts USING fts5(
				title, subtitle, narrative, facts, concepts, files_read, files_modified,
				content=user_observations, content_rowid=_rowid, tokenize='porter unicode61'
			);

			CREATE TRIGGER user_observations_ai AFTER INSERT ON user_observations BEGIN
				INSERT INTO user_observations_fts(
					rowid, title, subtitle, narrative, facts, concepts,
					files_read, files_modified
				)
				VALUES (
					new._rowid, new.title, new.subtitle, new.narrative,
					new.facts, new.concepts, new.files_read, new.files_modified
				);
			END;

			CREATE TRIGGER user_observations_ad AFTER DELETE ON user_observations BEGIN
				INSERT INTO user_observations_fts(
					user_observations_fts, rowid, title, subtitle, narrative,
					facts, concepts, files_read, files_modified
				)
				VALUES (
					'delete', old._rowid, old.title, old.subtitle, old.narrative,
					old.facts, old.concepts, old.files_read, old.files_modified
				);
			END;

			CREATE TRIGGER user_observations_au AFTER UPDATE ON user_observations BEGIN
				INSERT INTO user_observations_fts(
					user_observations_fts, rowid, title, subtitle, narrative,
					facts, concepts, files_read, files_modified
				)
				VALUES (
					'delete', old._rowid, old.title, old.subtitle, old.narrative,
					old.facts, old.concepts, old.files_read, old.files_modified
				);
				INSERT INTO user_observations_fts(
					rowid, title, subtitle, narrative, facts, concepts,
					files_read, files_modified
				)
				VALUES (
					new._rowid, new.title, new.subtitle, new.narrative,
					new.facts, new.concepts, new.files_read, new.files_modified
				);
			END;
		`,
	},
];

// -----------------------------------------------------------------------------
// UserMemoryDatabase
// -----------------------------------------------------------------------------

export class UserMemoryDatabase {
	private db: Database;

	constructor(dbPath: string) {
		const resolved = resolveUserDbPath(dbPath);
		this.db = createDatabase(resolved);
		this.initializeUserSchema();
	}

	private initializeUserSchema(): void {
		this.db.migrate(USER_MIGRATIONS);
	}

	get database(): Database {
		return this.db;
	}

	close(): void {
		this.db.close();
	}
}

// -----------------------------------------------------------------------------
// UserObservationRepository
// -----------------------------------------------------------------------------

export class UserObservationRepository {
	constructor(private db: Database) {}

	create(
		data: Omit<UserObservation, "id" | "createdAt">,
	): UserObservation {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO user_observations
				(id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, tool_name,
				 created_at, token_count, importance, source_project)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.type,
				data.title,
				data.subtitle,
				JSON.stringify(data.facts),
				data.narrative,
				JSON.stringify(data.concepts),
				JSON.stringify(data.filesRead),
				JSON.stringify(data.filesModified),
				data.toolName,
				now,
				data.tokenCount,
				data.importance ?? 3,
				data.sourceProject,
			],
		);
		return { ...data, id, createdAt: now, importance: data.importance ?? 3 };
	}

	search(query: {
		query: string;
		limit?: number;
		sourceProject?: string;
	}): Array<{ observation: UserObservation; rank: number }> {
		let sql = `
			SELECT o.*, rank
			FROM user_observations o
			JOIN user_observations_fts fts ON o._rowid = fts.rowid
			WHERE user_observations_fts MATCH ?
		`;
		const params: (string | number)[] = [query.query];

		if (query.sourceProject) {
			sql += " AND o.source_project = ?";
			params.push(query.sourceProject);
		}

		sql += " ORDER BY rank LIMIT ?";
		params.push(query.limit ?? 10);

		return this.db
			.all<UserObservationSearchRow>(sql, params)
			.map((row) => ({
				observation: this.mapRow(row),
				rank: row.rank,
			}));
	}

	getIndex(
		limit?: number,
		sourceProject?: string,
	): ObservationIndex[] {
		let sql = `SELECT id, type, title, token_count, created_at, importance, source_project
			 FROM user_observations`;
		const params: (string | number)[] = [];

		if (sourceProject) {
			sql += " WHERE source_project = ?";
			params.push(sourceProject);
		}

		sql += " ORDER BY created_at DESC LIMIT ?";
		params.push(limit ?? 20);

		return this.db
			.all<UserObservationIndexRow>(sql, params)
			.map((r) => ({
				id: r.id,
				sessionId: "",
				type: r.type as ObservationType,
				title: r.title,
				tokenCount: r.token_count,
				discoveryTokens: 0,
				createdAt: r.created_at,
				importance: r.importance ?? 3,
			}));
	}

	getById(id: string): UserObservation | null {
		const row = this.db.get<UserObservationRow>(
			"SELECT * FROM user_observations WHERE id = ?",
			[id],
		);
		return row ? this.mapRow(row) : null;
	}

	delete(id: string): boolean {
		const result = this.db.all<{ id: string }>(
			"DELETE FROM user_observations WHERE id = ? RETURNING id",
			[id],
		);
		return result.length > 0;
	}

	private mapRow(row: UserObservationRow): UserObservation {
		return {
			id: row.id,
			type: row.type as ObservationType,
			title: row.title,
			subtitle: row.subtitle,
			facts: JSON.parse(row.facts),
			narrative: row.narrative,
			concepts: JSON.parse(row.concepts),
			filesRead: JSON.parse(row.files_read),
			filesModified: JSON.parse(row.files_modified),
			toolName: row.tool_name,
			createdAt: row.created_at,
			tokenCount: row.token_count,
			importance: row.importance ?? 3,
			sourceProject: row.source_project,
		};
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function resolveUserDbPath(dbPath: string): string {
	if (dbPath.startsWith("~/")) {
		const home = process.env.HOME || process.env.USERPROFILE || "";
		return `${home}${dbPath.slice(1)}`;
	}
	return dbPath;
}
