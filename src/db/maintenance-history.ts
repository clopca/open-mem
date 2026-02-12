import type { MaintenanceHistoryItem } from "../types";
import type { Database } from "./database";

interface MaintenanceHistoryRow {
	id: string;
	timestamp: string;
	action: string;
	dry_run: number;
	result: string;
}

function parseJsonRecord(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export class MaintenanceHistoryRepository {
	constructor(private db: Database) {}

	list(): MaintenanceHistoryItem[] {
		return this.db
			.all<MaintenanceHistoryRow>(
				"SELECT id, timestamp, action, dry_run, result FROM maintenance_history ORDER BY timestamp DESC",
			)
			.map((row) => ({
				id: row.id,
				timestamp: row.timestamp,
				action: row.action,
				dryRun: row.dry_run === 1,
				result: parseJsonRecord(row.result),
			}));
	}

	append(item: MaintenanceHistoryItem): void {
		this.db.run(
			"INSERT INTO maintenance_history (id, timestamp, action, dry_run, result) VALUES (?, ?, ?, ?, ?)",
			[
				item.id,
				item.timestamp,
				item.action,
				item.dryRun ? 1 : 0,
				JSON.stringify(item.result ?? {}),
			],
		);
	}
}
