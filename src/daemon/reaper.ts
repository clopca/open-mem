// =============================================================================
// open-mem — Orphan Daemon Reaper
// =============================================================================

import { existsSync } from "node:fs";
import { getPidPath, isProcessAlive, readPid, removePid } from "./pid";

/** Result of an orphan daemon reap operation. */
export interface ReapResult {
	reaped: number;
	errors: string[];
}

/**
 * Reap orphan daemon PID files for a given database path.
 *
 * - If no PID file exists → no-op
 * - If PID file exists but process is dead → remove stale PID file
 * - If PID file exists and process is alive → skip (don't kill random processes)
 * - If PID file is invalid (non-numeric) → remove corrupt PID file
 */
export function reapOrphanDaemons(dbPath: string): ReapResult {
	const result: ReapResult = { reaped: 0, errors: [] };

	try {
		const pidPath = getPidPath(dbPath);
		const pid = readPid(pidPath);

		if (pid === null) {
			// readPid returns null for both missing files and invalid content —
			// if the file exists but content is unparseable, it's corrupt
			try {
				if (existsSync(pidPath)) {
					removePid(pidPath);
					if (!existsSync(pidPath)) {
						result.reaped++;
						console.log("[open-mem] Reaped corrupt daemon PID file");
					} else {
						result.errors.push(
							"Failed to remove corrupt PID file: file still exists after removal",
						);
					}
				}
			} catch (err) {
				result.errors.push(
					`Failed to check/remove corrupt PID file: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
			return result;
		}

		if (isProcessAlive(pid)) {
			// Don't kill — could be a legitimate daemon or a reused PID
			return result;
		}

		removePid(pidPath);
		if (!existsSync(pidPath)) {
			result.reaped++;
			console.log(`[open-mem] Reaped stale daemon PID file (pid=${pid})`);
		} else {
			result.errors.push(
				`Failed to remove stale PID file (pid=${pid}): file still exists after removal`,
			);
		}
	} catch (err) {
		result.errors.push(`Reaper error: ${err instanceof Error ? err.message : String(err)}`);
	}

	return result;
}
