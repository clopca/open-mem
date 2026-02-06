// =============================================================================
// open-mem — Observation Repository (CRUD + FTS5 Search)
// =============================================================================

import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import type {
	Observation,
	ObservationIndex,
	ObservationType,
	SearchQuery,
	SearchResult,
} from "../types";

export class ObservationRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	create(
		data: Omit<Observation, "id" | "createdAt">,
	): Observation {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output,
				 tool_name, created_at, token_count)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.sessionId,
				data.type,
				data.title,
				data.subtitle,
				JSON.stringify(data.facts),
				data.narrative,
				JSON.stringify(data.concepts),
				JSON.stringify(data.filesRead),
				JSON.stringify(data.filesModified),
				data.rawToolOutput,
				data.toolName,
				now,
				data.tokenCount,
			],
		);
		return { ...data, id, createdAt: now };
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getById(id: string): Observation | null {
		const row = this.db.get<Record<string, unknown>>(
			"SELECT * FROM observations WHERE id = ?",
			[id],
		);
		return row ? this.mapRow(row) : null;
	}

	getBySession(sessionId: string): Observation[] {
		return this.db
			.all<Record<string, unknown>>(
				"SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC",
				[sessionId],
			)
			.map((r) => this.mapRow(r));
	}

	getCount(sessionId?: string): number {
		if (sessionId) {
			const row = this.db.get<{ count: number }>(
				"SELECT COUNT(*) as count FROM observations WHERE session_id = ?",
				[sessionId],
			);
			return row?.count ?? 0;
		}
		const row = this.db.get<{ count: number }>(
			"SELECT COUNT(*) as count FROM observations",
		);
		return row?.count ?? 0;
	}

	/** Lightweight index for progressive disclosure */
	getIndex(projectPath: string, limit = 20): ObservationIndex[] {
		return this.db
			.all<Record<string, unknown>>(
				`SELECT o.id, o.session_id, o.type, o.title, o.token_count, o.created_at
				 FROM observations o
				 JOIN sessions s ON o.session_id = s.id
				 WHERE s.project_path = ?
				 ORDER BY o.created_at DESC
				 LIMIT ?`,
				[projectPath, limit],
			)
			.map((r) => ({
				id: r.id as string,
				sessionId: r.session_id as string,
				type: r.type as ObservationType,
				title: r.title as string,
				tokenCount: r.token_count as number,
				createdAt: r.created_at as string,
			}));
	}

	// ---------------------------------------------------------------------------
	// FTS5 Search
	// ---------------------------------------------------------------------------

	search(query: SearchQuery): SearchResult[] {
		let sql = `
			SELECT o.*, rank
			FROM observations o
			JOIN observations_fts fts ON o._rowid = fts.rowid
			WHERE observations_fts MATCH ?
		`;
		const params: (string | number)[] = [query.query];

		if (query.sessionId) {
			sql += " AND o.session_id = ?";
			params.push(query.sessionId);
		}
		if (query.type) {
			sql += " AND o.type = ?";
			params.push(query.type);
		}

		sql += " ORDER BY rank LIMIT ? OFFSET ?";
		params.push(query.limit ?? 10);
		params.push(query.offset ?? 0);

		return this.db.all<Record<string, unknown>>(sql, params).map((row) => ({
			observation: this.mapRow(row),
			rank: row.rank as number,
			snippet: row.title as string,
		}));
	}

	searchByConcept(concept: string, limit = 10): Observation[] {
		return this.db
			.all<Record<string, unknown>>(
				`SELECT o.*
				 FROM observations o
				 JOIN observations_fts fts ON o._rowid = fts.rowid
				 WHERE observations_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`,
				[`concepts:${concept}`, limit],
			)
			.map((r) => this.mapRow(r));
	}

	searchByFile(filePath: string, limit = 10): Observation[] {
		return this.db
			.all<Record<string, unknown>>(
				`SELECT o.*
				 FROM observations o
				 JOIN observations_fts fts ON o._rowid = fts.rowid
				 WHERE observations_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`,
				[`files_read:"${filePath}" OR files_modified:"${filePath}"`, limit],
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapRow(row: Record<string, unknown>): Observation {
		return {
			id: row.id as string,
			sessionId: row.session_id as string,
			type: row.type as ObservationType,
			title: row.title as string,
			subtitle: row.subtitle as string,
			facts: JSON.parse(row.facts as string),
			narrative: row.narrative as string,
			concepts: JSON.parse(row.concepts as string),
			filesRead: JSON.parse(row.files_read as string),
			filesModified: JSON.parse(row.files_modified as string),
			rawToolOutput: row.raw_tool_output as string,
			toolName: row.tool_name as string,
			createdAt: row.created_at as string,
			tokenCount: row.token_count as number,
		};
	}
}
