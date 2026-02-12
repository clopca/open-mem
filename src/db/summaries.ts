// =============================================================================
// open-mem — Summary Repository
// =============================================================================

import { randomUUID } from "node:crypto";
import type { SessionSummary } from "../types";
import type { Database } from "./database";

interface SummaryRow {
	id: string;
	session_id: string;
	summary: string;
	key_decisions: string;
	files_modified: string;
	concepts: string;
	created_at: string;
	token_count: number;
	request: string;
	investigated: string;
	learned: string;
	completed: string;
	next_steps: string;
}

/** Repository for session summary CRUD operations. */
export class SummaryRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	create(data: Omit<SessionSummary, "id" | "createdAt">): SessionSummary {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO session_summaries
				(id, session_id, summary, key_decisions, files_modified,
				 concepts, created_at, token_count,
				 request, investigated, learned, completed, next_steps)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				data.sessionId,
				data.summary,
				JSON.stringify(data.keyDecisions),
				JSON.stringify(data.filesModified),
				JSON.stringify(data.concepts),
				now,
				data.tokenCount,
				data.request ?? "",
				data.investigated ?? "",
				data.learned ?? "",
				data.completed ?? "",
				data.nextSteps ?? "",
			],
		);
		return { ...data, id, createdAt: now };
	}

	importSummary(data: SessionSummary): void {
		this.db.run(
			`INSERT INTO session_summaries
				(id, session_id, summary, key_decisions, files_modified,
				 concepts, created_at, token_count,
				 request, investigated, learned, completed, next_steps)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				data.id,
				data.sessionId,
				data.summary,
				JSON.stringify(data.keyDecisions),
				JSON.stringify(data.filesModified),
				JSON.stringify(data.concepts),
				data.createdAt,
				data.tokenCount,
				data.request ?? "",
				data.investigated ?? "",
				data.learned ?? "",
				data.completed ?? "",
				data.nextSteps ?? "",
			],
		);
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getBySessionId(sessionId: string): SessionSummary | null {
		const row = this.db.get<SummaryRow>("SELECT * FROM session_summaries WHERE session_id = ?", [
			sessionId,
		]);
		return row ? this.mapRow(row) : null;
	}

	getRecent(limit = 10): SessionSummary[] {
		return this.db
			.all<SummaryRow>("SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?", [limit])
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// FTS5 Search
	// ---------------------------------------------------------------------------

	search(query: string, limit = 10): SessionSummary[] {
		return this.db
			.all<SummaryRow>(
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

	private mapRow(row: SummaryRow): SessionSummary {
		return {
			id: row.id,
			sessionId: row.session_id,
			summary: row.summary,
			keyDecisions: JSON.parse(row.key_decisions),
			filesModified: JSON.parse(row.files_modified),
			concepts: JSON.parse(row.concepts),
			createdAt: row.created_at,
			tokenCount: row.token_count,
			request: row.request || undefined,
			investigated: row.investigated || undefined,
			learned: row.learned || undefined,
			completed: row.completed || undefined,
			nextSteps: row.next_steps || undefined,
		};
	}
}
