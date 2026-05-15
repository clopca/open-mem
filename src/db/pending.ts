// =============================================================================
// open-mem — Pending Message Repository (Queue Persistence)
// =============================================================================

import { randomUUID } from "node:crypto";
import type { PendingMessage } from "../types";
import type { Database } from "./database";

interface PendingMessageRow {
	id: string;
	session_id: string;
	tool_name: string;
	tool_output: string;
	call_id: string;
	created_at: string;
	status: string;
	retry_count: number;
	error: string | null;
}

/** Repository for pending message queue operations. */
export class PendingMessageRepository {
	constructor(private db: Database) {}

	// ---------------------------------------------------------------------------
	// Create
	// ---------------------------------------------------------------------------

	create(
		data: Omit<PendingMessage, "id" | "createdAt" | "status" | "retryCount" | "error">,
	): PendingMessage {
		const id = randomUUID();
		const now = new Date().toISOString();
		this.db.run(
			`INSERT INTO pending_messages
				(id, session_id, tool_name, tool_output, call_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			[id, data.sessionId, data.toolName, data.toolOutput, data.callId, now],
		);
		return {
			...data,
			id,
			createdAt: now,
			status: "pending",
			retryCount: 0,
			error: null,
		};
	}

	// ---------------------------------------------------------------------------
	// Read
	// ---------------------------------------------------------------------------

	getPending(limit = 10): PendingMessage[] {
		return this.db
			.all<PendingMessageRow>(
				"SELECT * FROM pending_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
				[limit],
			)
			.map((r) => this.mapRow(r));
	}

	getByStatus(status: PendingMessage["status"]): PendingMessage[] {
		return this.db
			.all<PendingMessageRow>(
				"SELECT * FROM pending_messages WHERE status = ? ORDER BY created_at ASC",
				[status],
			)
			.map((r) => this.mapRow(r));
	}

	// ---------------------------------------------------------------------------
	// Status Transitions
	// ---------------------------------------------------------------------------

	markProcessing(id: string): void {
		this.db.run("UPDATE pending_messages SET status = 'processing' WHERE id = ?", [id]);
	}

	markCompleted(id: string): void {
		this.db.run("UPDATE pending_messages SET status = 'completed' WHERE id = ?", [id]);
	}

	markFailed(id: string, error: string): void {
		this.db.run(
			"UPDATE pending_messages SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?",
			[error, id],
		);
	}

	/**
	 * Reset stale "processing" messages back to "pending".
	 * Handles the case where the plugin crashes mid-processing.
	 * Returns the number of messages reset.
	 */
	resetStale(olderThanMinutes = 5): number {
		const result = this.db.all<{ id: string }>(
			`UPDATE pending_messages SET status = 'pending'
			 WHERE status = 'processing'
			 AND created_at < datetime('now', ? || ' minutes')
			 RETURNING id`,
			[`-${olderThanMinutes}`],
		);
		return result.length;
	}

	deleteCompletedOlderThan(days: number): number {
		const result = this.db.all<{ id: string }>(
			`DELETE FROM pending_messages
			 WHERE status = 'completed'
			 AND created_at < datetime('now', '-' || ? || ' days')
			 RETURNING id`,
			[days],
		);
		return result.length;
	}

	/**
	 * Delete all pending and failed messages for a given session.
	 * Used for cleanup after /undo — removes orphaned items that would
	 * otherwise be compressed into observations tied to an undone message.
	 * Never deletes items in "processing" or "completed" status.
	 * Returns the number of items deleted.
	 */
	deleteBySessionId(sessionId: string): number {
		const result = this.db.all<{ id: string }>(
			`DELETE FROM pending_messages
			 WHERE session_id = ?
			 AND status IN ('pending', 'failed')
			 RETURNING id`,
			[sessionId],
		);
		return result.length;
	}

	// ---------------------------------------------------------------------------
	// Row Mapping
	// ---------------------------------------------------------------------------

	private mapRow(row: PendingMessageRow): PendingMessage {
		return {
			id: row.id,
			sessionId: row.session_id,
			toolName: row.tool_name,
			toolOutput: row.tool_output,
			callId: row.call_id,
			createdAt: row.created_at,
			status: row.status as PendingMessage["status"],
			retryCount: row.retry_count,
			error: row.error ?? null,
		};
	}
}
