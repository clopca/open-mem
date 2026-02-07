// =============================================================================
// open-mem — Observation Repository (CRUD + FTS5 Search)
// =============================================================================

import { randomUUID } from "node:crypto";
import { cosineSimilarity } from "../search/embeddings";
import type {
	Observation,
	ObservationIndex,
	ObservationType,
	SearchQuery,
	SearchResult,
} from "../types";
import type { Database } from "./database";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function escapeLike(value: string): string {
	return value.replace(/[%_\\]/g, "\\$&");
}

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
	importance: number;
	superseded_by: string | null;
	superseded_at: string | null;
}

interface ObservationIndexRow {
	id: string;
	session_id: string;
	type: string;
	title: string;
	token_count: number;
	discovery_tokens: number;
	created_at: string;
	importance: number;
}

interface ObservationSearchRow extends ObservationRow {
	rank: number;
}

interface EmbeddingRow {
	id: string;
	embedding: string;
	title: string;
}

/** Repository for observation CRUD, FTS5 search, and embedding operations. */
export class ObservationRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	/** Create a new observation and return it with generated ID and timestamp. */
	create(data: Omit<Observation, "id" | "createdAt" | "supersededBy" | "supersededAt">): Observation {
		const id = randomUUID();
		const now = new Date().toISOString();
		const discoveryTokens = data.discoveryTokens ?? 0;
		const importance = data.importance ?? 3;
		this.db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output,
				 tool_name, created_at, token_count, discovery_tokens, importance)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				importance,
			],
		);
		return { ...data, id, createdAt: now, discoveryTokens, importance, supersededBy: null, supersededAt: null };
	}

	/** Import an observation with a pre-existing ID (for data migration). */
	importObservation(data: Observation): void {
		this.db.run(
			`INSERT INTO observations
				(id, session_id, type, title, subtitle, facts, narrative,
				 concepts, files_read, files_modified, raw_tool_output,
				 tool_name, created_at, token_count, discovery_tokens, importance)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
				data.importance ?? 3,
			],
		);
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	/** Get an observation by its unique ID. */
	getById(id: string): Observation | null {
		const row = this.db.get<ObservationRow>("SELECT * FROM observations WHERE id = ?", [id]);
		return row ? this.mapRow(row) : null;
	}

	/** Get all observations for a session, ordered by creation time. */
	getBySession(sessionId: string): Observation[] {
		return this.db
			.all<ObservationRow>(
				"SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC",
				[sessionId],
			)
			.map((r) => this.mapRow(r));
	}

	/** Get the total observation count, optionally filtered by session. */
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
				`SELECT o.id, o.session_id, o.type, o.title, o.token_count, o.discovery_tokens, o.created_at, o.importance
				 FROM observations o
				 JOIN sessions s ON o.session_id = s.id
				 WHERE s.project_path = ? AND o.superseded_by IS NULL
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
				importance: r.importance ?? 3,
			}));
	}

	// ---------------------------------------------------------------------------
	// FTS5 Search
	// ---------------------------------------------------------------------------

	/** Search observations using FTS5 full-text search with optional filters. */
	search(query: SearchQuery): SearchResult[] {
		const hasProjectPath = !!query.projectPath;
		let sql = `
			SELECT o.*, rank
			FROM observations o
			JOIN observations_fts fts ON o._rowid = fts.rowid
			${hasProjectPath ? "JOIN sessions s ON o.session_id = s.id" : ""}
			WHERE observations_fts MATCH ? AND o.superseded_by IS NULL
		`;
		const params: (string | number)[] = [query.query];

		if (hasProjectPath && query.projectPath) {
			sql += " AND s.project_path = ?";
			params.push(query.projectPath);
		}
		if (query.sessionId) {
			sql += " AND o.session_id = ?";
			params.push(query.sessionId);
		}
		if (query.type) {
			sql += " AND o.type = ?";
			params.push(query.type);
		}
		if (query.importanceMin !== undefined) {
			sql += " AND o.importance >= ?";
			params.push(query.importanceMin);
		}
		if (query.importanceMax !== undefined) {
			sql += " AND o.importance <= ?";
			params.push(query.importanceMax);
		}
		if (query.createdAfter) {
			sql += " AND o.created_at >= ?";
			params.push(query.createdAfter);
		}
		if (query.createdBefore) {
			sql += " AND o.created_at <= ?";
			params.push(query.createdBefore);
		}
		if (query.concepts && query.concepts.length > 0) {
			const conceptClauses = query.concepts.map(() => "o.concepts LIKE ? ESCAPE '\\'");
			sql += ` AND (${conceptClauses.join(" OR ")})`;
			for (const c of query.concepts) {
				params.push(`%${escapeLike(c)}%`);
			}
		}
		if (query.files && query.files.length > 0) {
			const fileClauses = query.files.map(
				() => "(o.files_read LIKE ? ESCAPE '\\' OR o.files_modified LIKE ? ESCAPE '\\')",
			);
			sql += ` AND (${fileClauses.join(" OR ")})`;
			for (const f of query.files) {
				const escaped = `%${escapeLike(f)}%`;
				params.push(escaped, escaped);
			}
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

	/** Search observations by concept tag using FTS5. */
	searchByConcept(concept: string, limit = 10, projectPath?: string): Observation[] {
		const hasProjectPath = !!projectPath;
		const sql = `SELECT o.*
				 FROM observations o
				 JOIN observations_fts fts ON o._rowid = fts.rowid
				 ${hasProjectPath ? "JOIN sessions s ON o.session_id = s.id" : ""}
				 WHERE observations_fts MATCH ?
				 ${hasProjectPath ? "AND s.project_path = ?" : ""}
				 ORDER BY rank
				 LIMIT ?`;
		const params: (string | number)[] = [`concepts:${concept}`];
		if (hasProjectPath && projectPath) {
			params.push(projectPath);
		}
		params.push(limit);
		return this.db.all<ObservationRow>(sql, params).map((r) => this.mapRow(r));
	}

	/** Search observations by file path using FTS5. */
	searchByFile(filePath: string, limit = 10, projectPath?: string): Observation[] {
		const hasProjectPath = !!projectPath;
		const sql = `SELECT o.*
				 FROM observations o
				 JOIN observations_fts fts ON o._rowid = fts.rowid
				 ${hasProjectPath ? "JOIN sessions s ON o.session_id = s.id" : ""}
				 WHERE observations_fts MATCH ?
				 ${hasProjectPath ? "AND s.project_path = ?" : ""}
				 ORDER BY rank
				 LIMIT ?`;
		const params: (string | number)[] = [
			`files_read:"${filePath.replace(/"/g, '""')}" OR files_modified:"${filePath.replace(/"/g, '""')}"`,
		];
		if (hasProjectPath && projectPath) {
			params.push(projectPath);
		}
		params.push(limit);
		return this.db.all<ObservationRow>(sql, params).map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Embedding Support
	// ---------------------------------------------------------------------------

	/** Store an embedding vector for an observation. */
	setEmbedding(id: string, embedding: number[]): void {
		this.db.run("UPDATE observations SET embedding = ? WHERE id = ?", [
			JSON.stringify(embedding),
			id,
		]);
	}

	/** Get observations with their embedding vectors for a project. */
	getWithEmbeddings(
		projectPath: string,
		limit: number,
	): Array<{ id: string; embedding: number[]; title: string }> {
		return this.db
			.all<EmbeddingRow>(
				`SELECT o.id, o.embedding, o.title
				 FROM observations o
				 JOIN sessions s ON o.session_id = s.id
				 WHERE s.project_path = ? AND o.embedding IS NOT NULL AND o.superseded_by IS NULL
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
	// Embedding Similarity Search (for deduplication)
	// ---------------------------------------------------------------------------

	/** Find observations similar to a given embedding above a similarity threshold. */
	findSimilar(
		embedding: number[],
		type: ObservationType,
		threshold: number,
		limit: number,
	): Array<{ id: string; similarity: number }> {
		const rows = this.db.all<{ id: string; embedding: string }>(
			`SELECT id, embedding FROM observations
			 WHERE embedding IS NOT NULL AND type = ? AND superseded_by IS NULL
			 ORDER BY created_at DESC
			 LIMIT 200`,
			[type],
		);

		const scored: Array<{ id: string; similarity: number }> = [];

		for (const row of rows) {
			try {
				const stored: unknown = JSON.parse(row.embedding);
				if (!Array.isArray(stored) || stored.length !== embedding.length) continue;

				const similarity = cosineSimilarity(embedding, stored as number[]);
				if (similarity >= threshold) {
					scored.push({ id: row.id, similarity });
				}
			} catch {}
		}

		return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
	}

	// ---------------------------------------------------------------------------
	// Vec0 Embedding Support
	// ---------------------------------------------------------------------------

	/** Insert an embedding into the vec0 virtual table for native KNN search. */
	insertVecEmbedding(observationId: string, embedding: number[]): void {
		const float32 = new Float32Array(embedding);
		this.db.run("BEGIN");
		try {
			this.db.run("DELETE FROM observation_embeddings WHERE observation_id = ?", [observationId]);
			this.db.run("INSERT INTO observation_embeddings (observation_id, embedding) VALUES (?, ?)", [
				observationId,
				float32,
			]);
			this.db.run("COMMIT");
		} catch (e) {
			this.db.run("ROLLBACK");
			throw e;
		}
	}

	/** Migrate existing JSON embeddings to the vec0 virtual table. */
	migrateExistingEmbeddings(dimension: number): { migrated: number; skipped: number } {
		const rows = this.db.all<{ id: string; embedding: string }>(
			"SELECT id, embedding FROM observations WHERE embedding IS NOT NULL",
		);

		let migrated = 0;
		let skipped = 0;

		for (const row of rows) {
			try {
				const parsed: unknown = JSON.parse(row.embedding);
				if (!Array.isArray(parsed) || parsed.length !== dimension) {
					skipped++;
					continue;
				}
				this.insertVecEmbedding(row.id, parsed);
				migrated++;
			} catch {
				skipped++;
			}
		}

		return { migrated, skipped };
	}

	// ---------------------------------------------------------------------------
	// Vec0 KNN Search
	// ---------------------------------------------------------------------------

	/** Perform KNN search using the vec0 virtual table. */
	getVecEmbeddingMatches(
		queryEmbedding: number[],
		limit: number,
	): Array<{ observationId: string; distance: number }> {
		try {
			const float32 = new Float32Array(queryEmbedding);
			return this.db
				.all<{ observation_id: string; distance: number }>(
					`SELECT observation_id, distance
					 FROM observation_embeddings
					 WHERE embedding MATCH ? AND k = ?`,
					[float32, limit],
				)
				.map((row) => ({
					observationId: row.observation_id,
					distance: row.distance,
				}));
		} catch {
			return [];
		}
	}

	/** Search vec0 embeddings filtered to a subset of observation IDs. */
	searchVecSubset(
		queryEmbedding: number[],
		observationIds: string[],
		limit: number,
	): Array<{ observationId: string; distance: number }> {
		if (observationIds.length === 0) return [];

		try {
			const float32 = new Float32Array(queryEmbedding);
			const fetchCount = Math.max(limit * 5, observationIds.length);
			const allMatches = this.db.all<{ observation_id: string; distance: number }>(
				`SELECT observation_id, distance
				 FROM observation_embeddings
				 WHERE embedding MATCH ? AND k = ?`,
				[float32, fetchCount],
			);

			const idSet = new Set(observationIds);
			return allMatches
				.filter((row) => idSet.has(row.observation_id))
				.slice(0, limit)
				.map((row) => ({
					observationId: row.observation_id,
					distance: row.distance,
				}));
		} catch {
			return [];
		}
	}

	// ---------------------------------------------------------------------------
	// Update / Delete
	// ---------------------------------------------------------------------------

	/** Update selected fields of an observation. */
	update(
		id: string,
		data: Partial<Pick<Observation, "title" | "narrative" | "type" | "concepts" | "importance" | "facts" | "subtitle" | "filesRead" | "filesModified">>,
	): Observation | null {
		const existing = this.getById(id);
		if (!existing) return null;

		const setClauses: string[] = [];
		const params: (string | number)[] = [];

		if (data.title !== undefined) {
			setClauses.push("title = ?");
			params.push(data.title);
		}
		if (data.narrative !== undefined) {
			setClauses.push("narrative = ?");
			params.push(data.narrative);
		}
		if (data.type !== undefined) {
			setClauses.push("type = ?");
			params.push(data.type);
		}
		if (data.concepts !== undefined) {
			setClauses.push("concepts = ?");
			params.push(JSON.stringify(data.concepts));
		}
		if (data.importance !== undefined) {
			setClauses.push("importance = ?");
			params.push(data.importance);
		}
		if (data.facts !== undefined) {
			setClauses.push("facts = ?");
			params.push(JSON.stringify(data.facts));
		}
		if (data.subtitle !== undefined) {
			setClauses.push("subtitle = ?");
			params.push(data.subtitle);
		}
		if (data.filesRead !== undefined) {
			setClauses.push("files_read = ?");
			params.push(JSON.stringify(data.filesRead));
		}
		if (data.filesModified !== undefined) {
			setClauses.push("files_modified = ?");
			params.push(JSON.stringify(data.filesModified));
		}

		if (setClauses.length === 0) return existing;

		params.push(id);
		this.db.run(`UPDATE observations SET ${setClauses.join(", ")} WHERE id = ?`, params);
		return this.getById(id);
	}

	/** Mark an observation as superseded by a newer one. */
	supersede(observationId: string, newObservationId: string): void {
		const now = new Date().toISOString();
		this.db.run(
			"UPDATE observations SET superseded_by = ?, superseded_at = ? WHERE id = ?",
			[newObservationId, now, observationId],
		);
	}

	/** Delete an observation by ID, including its embeddings. */
	delete(id: string): boolean {
		const result = this.db.all<{ id: string }>(
			"DELETE FROM observations WHERE id = ? RETURNING id",
			[id],
		);
		if (result.length === 0) return false;

		this.deleteEmbeddingsForObservations([id]);
		return true;
	}

	// ---------------------------------------------------------------------------
	// Retention / Cleanup
	// ---------------------------------------------------------------------------

	/** Delete observations older than the specified number of days. */
	deleteOlderThan(days: number): number {
		const deleted = this.db.all<{ id: string }>(
			`DELETE FROM observations
			 WHERE created_at < datetime('now', '-' || ? || ' days')
			 AND session_id NOT IN (SELECT id FROM sessions WHERE status != 'completed')
			 RETURNING id`,
			[days],
		);
		return deleted.length;
	}

	/** Remove vec0 embeddings and clear JSON embedding column for given IDs. */
	deleteEmbeddingsForObservations(ids: string[]): void {
		if (ids.length === 0) return;

		const placeholders = ids.map(() => "?").join(",");
		try {
			this.db.run(
				`DELETE FROM observation_embeddings WHERE observation_id IN (${placeholders})`,
				ids,
			);
		} catch {
			// vec0 table may not exist if sqlite-vec extension isn't loaded
		}
		this.db.run(`UPDATE observations SET embedding = NULL WHERE id IN (${placeholders})`, ids);
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
			importance: row.importance ?? 3,
			supersededBy: row.superseded_by ?? null,
			supersededAt: row.superseded_at ?? null,
		};
	}
}
