#!/usr/bin/env bun

import { rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveConfig } from "./config";
import { getMaintenancePreflightStatus } from "./daemon/manager";
import { createDatabase, Database, type WalCheckpointMode } from "./db/database";
import { ObservationRepository } from "./db/observations";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { cleanFolderContext, rebuildFolderContext } from "./utils/folder-context-maintenance";
import { getCanonicalProjectPath } from "./utils/worktree";

const { positionals, values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		project: { type: "string", short: "p" },
		"dry-run": { type: "boolean", default: false },
		force: { type: "boolean", default: false },
		mode: { type: "string" },
		"max-errors": { type: "string" },
	},
	allowPositionals: true,
	strict: false,
});

const command = positionals[0] ?? "help";
const sub = positionals[1] ?? "";
const projectDir = typeof values.project === "string" ? values.project : process.cwd();
const projectPath = getCanonicalProjectPath(projectDir);

const CHECKPOINT_MODES = new Set<WalCheckpointMode>(["PASSIVE", "FULL", "RESTART", "TRUNCATE"]);

function printUsage() {
	console.log(`Usage:
  open-mem-maintenance reset-db --project <path> [--force]
  open-mem-maintenance sqlite checkpoint --project <path> [--mode <PASSIVE|FULL|RESTART|TRUNCATE>]
  open-mem-maintenance sqlite integrity --project <path> [--max-errors <n>]
  open-mem-maintenance folder-context clean --project <path> [--dry-run]
  open-mem-maintenance folder-context rebuild --project <path> [--dry-run]`);
}

function reportMaintenanceSuccess(payload: Record<string, unknown>): void {
	console.log(JSON.stringify(payload, null, 2));
}

function reportMaintenanceFailure(payload: Record<string, unknown>): void {
	console.error(JSON.stringify(payload, null, 2));
	process.exitCode = 1;
}

async function main() {
	if (command === "help" || command === "--help" || command === "-h") {
		printUsage();
		return;
	}

	if (command === "reset-db") {
		const config = resolveConfig(projectPath);
		const forceReset = values.force === true;
		const preflight = getMaintenancePreflightStatus(config.dbPath);
		const detectedProcesses = preflight.activeProcesses.map((status) => {
			const pidText = status.pid !== null ? ` pid=${status.pid}` : "";
			return `${status.processType}${pidText}`;
		});

		if (preflight.blocked && !forceReset) {
			console.error("[open-mem] reset-db blocked: active processes detected.");
			console.error(`[open-mem] Detected process types: ${detectedProcesses.join(", ")}`);
			console.error("[open-mem] Remediation:");
			console.error("  1) Stop daemon and platform workers for this project.");
			console.error("  2) Retry reset-db after processes exit.");
			console.error("  3) To override (destructive), rerun with --force.");
			process.exitCode = 1;
			return;
		}

		if (preflight.blocked && forceReset) {
			console.warn("[open-mem] WARNING: --force set, continuing with destructive reset.");
			console.warn(`[open-mem] Active process types: ${detectedProcesses.join(", ")}`);
		}

		rmSync(config.dbPath, { force: true });
		rmSync(`${config.dbPath}-wal`, { force: true });
		rmSync(`${config.dbPath}-shm`, { force: true });
		rmSync(`${config.dbPath}.write.lock`, { force: true });
		console.log(
			`Removed database files for ${config.dbPath} (${config.dbPath}, ${config.dbPath}-wal, ${config.dbPath}-shm, ${config.dbPath}.write.lock)`,
		);
		return;
	}

	if (command === "sqlite" && (sub === "checkpoint" || sub === "integrity")) {
		let db: Database | null = null;
		let config: ReturnType<typeof resolveConfig> | null = null;

		try {
			config = resolveConfig(projectPath);
			Database.enableExtensionSupport();
			db = createDatabase(config.dbPath, { processRole: "maintenance" });

			if (sub === "checkpoint") {
				const rawMode = typeof values.mode === "string" ? values.mode.toUpperCase() : "PASSIVE";
				if (!CHECKPOINT_MODES.has(rawMode as WalCheckpointMode)) {
					reportMaintenanceFailure({
						operation: "wal_checkpoint",
						status: "failed",
						reason: `Invalid checkpoint mode: ${rawMode}`,
						nextSteps: ["Use one of: PASSIVE, FULL, RESTART, TRUNCATE"],
					});
					return;
				}

				const result = db.checkpointWal(rawMode as WalCheckpointMode);
				reportMaintenanceSuccess({
					operation: "wal_checkpoint",
					status: "ok",
					dbPath: config.dbPath,
					mode: result.mode,
					busy: result.busy,
					logFrames: result.logFrames,
					checkpointedFrames: result.checkpointedFrames,
					nextSteps:
						result.busy > 0
							? ["Some frames remain busy; retry during lower write activity or use --mode FULL."]
							: ["Checkpoint completed without busy frames."],
				});
				return;
			}

			const maxErrorsRaw = typeof values["max-errors"] === "string" ? values["max-errors"] : "1";
			const maxErrors = Number.parseInt(maxErrorsRaw, 10);
			if (!Number.isInteger(maxErrors) || maxErrors < 1) {
				reportMaintenanceFailure({
					operation: "integrity_check",
					status: "failed",
					reason: `Invalid --max-errors value: ${maxErrorsRaw}`,
					nextSteps: ["Use a positive integer, for example --max-errors 10"],
				});
				return;
			}

			const result = db.integrityCheck(maxErrors);
			if (!result.ok) {
				reportMaintenanceFailure({
					operation: "integrity_check",
					status: "failed",
					dbPath: config.dbPath,
					maxErrors: result.maxErrors,
					reason: "Integrity check returned SQLite issues.",
					details: result.messages,
					nextSteps: [
						"Inspect reported pages/indices.",
						"Restore from a known good backup if corruption is confirmed.",
					],
				});
				return;
			}

			reportMaintenanceSuccess({
				operation: "integrity_check",
				status: "ok",
				dbPath: config.dbPath,
				maxErrors: result.maxErrors,
				details: result.messages,
				nextSteps: ["No integrity problems reported."],
			});
			return;
		} catch (error) {
			reportMaintenanceFailure({
				operation: sub === "checkpoint" ? "wal_checkpoint" : "integrity_check",
				status: "failed",
				reason: error instanceof Error ? error.message : String(error),
				nextSteps: [
					"Ensure no external process is holding an exclusive lock.",
					"Retry the maintenance command.",
				],
			});
			return;
		} finally {
			db?.close();
		}
	}

	if (command === "folder-context" && (sub === "clean" || sub === "rebuild")) {
		const dryRun = values["dry-run"] === true;
		const config = resolveConfig(projectPath);
		if (sub === "clean") {
			const result = await cleanFolderContext(projectPath, config.folderContextFilename, dryRun);
			console.log(
				`${dryRun ? "[dry-run] " : ""}Scanned ${result.files.length} AGENTS.md files, changed ${result.changed}.`,
			);
			return;
		}

		Database.enableExtensionSupport();
		const db = createDatabase(config.dbPath, { processRole: "maintenance" });
		try {
			initializeSchema(db, {
				hasVectorExtension: db.hasVectorExtension,
				embeddingDimension: config.embeddingDimension,
			});
			const sessions = new SessionRepository(db);
			const observations = new ObservationRepository(db);
			const result = await rebuildFolderContext(
				projectPath,
				sessions,
				observations,
				{
					maxDepth: config.folderContextMaxDepth,
					mode: config.folderContextMode,
					filename: config.folderContextFilename,
				},
				dryRun,
			);
			console.log(
				`${dryRun ? "[dry-run] " : ""}Rebuilt context from ${result.observations} observations, touched ${result.filesTouched} files.`,
			);
			return;
		} finally {
			db.close();
		}
	}

	printUsage();
	process.exitCode = 1;
}

main();
