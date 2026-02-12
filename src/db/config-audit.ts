import type { ConfigAuditEvent } from "../types";
import type { Database } from "./database";

interface ConfigAuditRow {
	id: string;
	timestamp: string;
	patch: string;
	previous_values: string;
	source: string;
}

function parseJsonRecord(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export class ConfigAuditRepository {
	constructor(private db: Database) {}

	list(): ConfigAuditEvent[] {
		return this.db
			.all<ConfigAuditRow>(
				"SELECT id, timestamp, patch, previous_values, source FROM config_audit_events ORDER BY timestamp DESC",
			)
			.map((row) => ({
				id: row.id,
				timestamp: row.timestamp,
				patch: parseJsonRecord(row.patch),
				previousValues: parseJsonRecord(row.previous_values),
				source: row.source as ConfigAuditEvent["source"],
			}));
	}

	getById(id: string): ConfigAuditEvent | null {
		const row = this.db.get<ConfigAuditRow>(
			"SELECT id, timestamp, patch, previous_values, source FROM config_audit_events WHERE id = ?",
			[id],
		);
		if (!row) return null;
		return {
			id: row.id,
			timestamp: row.timestamp,
			patch: parseJsonRecord(row.patch),
			previousValues: parseJsonRecord(row.previous_values),
			source: row.source as ConfigAuditEvent["source"],
		};
	}

	append(event: ConfigAuditEvent): void {
		this.db.run(
			"INSERT INTO config_audit_events (id, timestamp, patch, previous_values, source) VALUES (?, ?, ?, ?, ?)",
			[
				event.id,
				event.timestamp,
				JSON.stringify(event.patch ?? {}),
				JSON.stringify(event.previousValues ?? {}),
				event.source,
			],
		);
	}
}
