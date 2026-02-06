// =============================================================================
// open-mem — Summary Repository
// =============================================================================

import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import type { SessionSummary } from "../types";

export class SummaryRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	create(
		data: Omit<SessionSummary, "id" | "createdAt">,
	): SessionSummary {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO session_summaries
				(id, session_id, summary, key_decisions, files_modified,
				 concepts, created_at, token_count)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.sessionId,
				data.summary,
				JSON.stringify(data.keyDecisions),
				JSON.stringify(data.filesModified),
				JSON.stringify(data.concepts),
				now,
				data.tokenCount,
			],
		);
		return { ...data, id, createdAt: now };
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getBySessionId(sessionId: string): SessionSummary | null {
		const row = this.db.get<Record<string, unknown>>(
			"SELECT * FROM session_summaries WHERE session_id = ?",
			[sessionId],
		);
		return row ? this.mapRow(row) : null;
	}

	getRecent(limit = 10): SessionSummary[] {
		return this.db
			.all<Record<string, unknown>>(
				"SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?",
				[limit],
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// FTS5 Search
	// ---------------------------------------------------------------------------

	search(query: string, limit = 10): SessionSummary[] {
		return this.db
			.all<Record<string, unknown>>(
				`SELECT ss.*
				 FROM session_summaries ss
				 JOIN summaries_fts fts ON ss._rowid = fts.rowid
				 WHERE summaries_fts MATCH ?
				 ORDER BY rank
				 LIMIT ?`,
				[query, limit],
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapRow(row: Record<string, unknown>): SessionSummary {
		return {
			id: row.id as string,
			sessionId: row.session_id as string,
			summary: row.summary as string,
			keyDecisions: JSON.parse(row.key_decisions as string),
			filesModified: JSON.parse(row.files_modified as string),
			concepts: JSON.parse(row.concepts as string),
			createdAt: row.created_at as string,
			tokenCount: row.token_count as number,
		};
	}
}
