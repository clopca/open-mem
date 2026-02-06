// =============================================================================
// open-mem — Session Repository
// =============================================================================

import type { Session } from "../types";
import type { Database } from "./database";

export class SessionRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create / Upsert
	// ---------------------------------------------------------------------------

	create(sessionId: string, projectPath: string): Session {
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO sessions (id, project_path, started_at, status)
			 VALUES (?, ?, ?, 'active')`,
			[sessionId, projectPath, now],
		);
		// biome-ignore lint/style/noNonNullAssertion: row was just inserted
		return this.getById(sessionId)!;
	}

	getOrCreate(sessionId: string, projectPath: string): Session {
		const existing = this.getById(sessionId);
		if (existing) return existing;
		return this.create(sessionId, projectPath);
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getById(id: string): Session | null {
		const row = this.db.get<Record<string, unknown>>("SELECT * FROM sessions WHERE id = ?", [id]);
		return row ? this.mapRow(row) : null;
	}

	getRecent(projectPath: string, limit = 10): Session[] {
		return this.db
			.all<Record<string, unknown>>(
				"SELECT * FROM sessions WHERE project_path = ? ORDER BY started_at DESC LIMIT ?",
				[projectPath, limit],
			)
			.map((r) => this.mapRow(r));
	}

	getActive(): Session[] {
		return this.db
			.all<Record<string, unknown>>(
				"SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC",
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Update
	// ---------------------------------------------------------------------------

	updateStatus(id: string, status: Session["status"]): void {
		this.db.run("UPDATE sessions SET status = ? WHERE id = ?", [status, id]);
	}

	markCompleted(id: string): void {
		this.db.run(
			"UPDATE sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
			[id],
		);
	}

	incrementObservationCount(id: string): void {
		this.db.run("UPDATE sessions SET observation_count = observation_count + 1 WHERE id = ?", [id]);
	}

	setSummary(sessionId: string, summaryId: string): void {
		this.db.run("UPDATE sessions SET summary_id = ? WHERE id = ?", [summaryId, sessionId]);
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapRow(row: Record<string, unknown>): Session {
		return {
			id: row.id as string,
			projectPath: row.project_path as string,
			startedAt: row.started_at as string,
			endedAt: (row.ended_at as string) ?? null,
			status: row.status as Session["status"],
			observationCount: row.observation_count as number,
			summaryId: (row.summary_id as string) ?? null,
		};
	}
}
