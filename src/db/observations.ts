// =============================================================================
// open-mem — Observation Repository (CRUD + FTS5 Search)
// =============================================================================

import { randomUUID } from "node:crypto";
import type {
	Observation,
	ObservationIndex,
	ObservationType,
	SearchQuery,
	SearchResult,
} from "../types";
import type { Database } from "./database";

// -----------------------------------------------------------------------------
// DB Row Types (match SQLite column names exactly)
// -----------------------------------------------------------------------------

interface ObservationRow {
	id: string;
	session_id: string;
	type: string;
	title: string;
	subtitle: string;
	facts: string;
	narrative: string;
	concepts: string;
	files_read: string;
	files_modified: string;
	raw_tool_output: string;
	tool_name: string;
	created_at: string;
	token_count: number;
	discovery_tokens: number;
	embedding: string | null;
}

interface ObservationIndexRow {
	id: string;
	session_id: string;
	type: string;
	title: string;
	token_count: number;
	discovery_tokens: number;
	created_at: string;
}

interface ObservationSearchRow extends ObservationRow {
	rank: number;
}

interface EmbeddingRow {
	id: string;
	embedding: string;
	title: string;
}

export class ObservationRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	create(data: Omit<Observation, "id" | "createdAt">): Observation {
		const id = randomUUID();
		const now = new Date().toISOString();
		const discoveryTokens = data.discoveryTokens ?? 0;
		this.db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output,
				 tool_name, created_at, token_count, discovery_tokens)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				discoveryTokens,
			],
		);
		return { ...data, id, createdAt: now, discoveryTokens };
	}

	importObservation(data: Observation): void {
		this.db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output,
				 tool_name, created_at, token_count, discovery_tokens)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				data.id,
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
				data.createdAt,
				data.tokenCount,
				data.discoveryTokens ?? 0,
			],
		);
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getById(id: string): Observation | null {
		const row = this.db.get<ObservationRow>("SELECT * FROM observations WHERE id = ?", [id]);
		return row ? this.mapRow(row) : null;
	}

	getBySession(sessionId: string): Observation[] {
		return this.db
			.all<ObservationRow>(
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
		const row = this.db.get<{ count: number }>("SELECT COUNT(*) as count FROM observations");
		return row?.count ?? 0;
	}

	/** Lightweight index for progressive disclosure */
	getIndex(projectPath: string, limit = 20): ObservationIndex[] {
		return this.db
			.all<ObservationIndexRow>(
				`SELECT o.id, o.session_id, o.type, o.title, o.token_count, o.discovery_tokens, o.created_at
				 FROM observations o
				 JOIN sessions s ON o.session_id = s.id
				 WHERE s.project_path = ?
				 ORDER BY o.created_at DESC
				 LIMIT ?`,
				[projectPath, limit],
			)
			.map((r) => ({
				id: r.id,
				sessionId: r.session_id,
				type: r.type as ObservationType,
				title: r.title,
				tokenCount: r.token_count,
				discoveryTokens: r.discovery_tokens ?? 0,
				createdAt: r.created_at,
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

		return this.db.all<ObservationSearchRow>(sql, params).map((row) => ({
			observation: this.mapRow(row),
			rank: row.rank,
			snippet: row.title,
		}));
	}

	searchByConcept(concept: string, limit = 10): Observation[] {
		return this.db
			.all<ObservationRow>(
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
			.all<ObservationRow>(
				`SELECT o.*
				 FROM observations o
				 JOIN observations_fts fts ON o._rowid = fts.rowid
				 WHERE observations_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`,
				[
					`files_read:"${filePath.replace(/"/g, '""')}" OR files_modified:"${filePath.replace(/"/g, '""')}"`,
					limit,
				],
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Embedding Support
	// ---------------------------------------------------------------------------

	setEmbedding(id: string, embedding: number[]): void {
		this.db.run("UPDATE observations SET embedding = ? WHERE id = ?", [
			JSON.stringify(embedding),
			id,
		]);
	}

	getWithEmbeddings(
		projectPath: string,
		limit: number,
	): Array<{ id: string; embedding: number[]; title: string }> {
		return this.db
			.all<EmbeddingRow>(
				`SELECT o.id, o.embedding, o.title
				 FROM observations o
				 JOIN sessions s ON o.session_id = s.id
				 WHERE s.project_path = ? AND o.embedding IS NOT NULL
				 ORDER BY o.created_at DESC
				 LIMIT ?`,
				[projectPath, limit],
			)
			.map((r) => {
				try {
					return {
						id: r.id,
						embedding: JSON.parse(r.embedding),
						title: r.title,
					};
				} catch {
					return null;
				}
			})
			.filter((r): r is NonNullable<typeof r> => r !== null);
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapRow(row: ObservationRow): Observation {
		return {
			id: row.id,
			sessionId: row.session_id,
			type: row.type as ObservationType,
			title: row.title,
			subtitle: row.subtitle,
			facts: JSON.parse(row.facts),
			narrative: row.narrative,
			concepts: JSON.parse(row.concepts),
			filesRead: JSON.parse(row.files_read),
			filesModified: JSON.parse(row.files_modified),
			rawToolOutput: row.raw_tool_output,
			toolName: row.tool_name,
			createdAt: row.created_at,
			tokenCount: row.token_count,
			discoveryTokens: row.discovery_tokens ?? 0,
		};
	}
}
