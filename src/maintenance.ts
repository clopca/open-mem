#!/usr/bin/env bun

import { rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveConfig } from "./config";
import { createDatabase, Database } from "./db/database";
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
	},
	allowPositionals: true,
	strict: false,
});

const command = positionals[0] ?? "help";
const sub = positionals[1] ?? "";
const projectDir = typeof values.project === "string" ? values.project : process.cwd();
const projectPath = getCanonicalProjectPath(projectDir);

function printUsage() {
	console.log(`Usage:
  open-mem-maintenance reset-db --project <path>
  open-mem-maintenance folder-context clean --project <path> [--dry-run]
  open-mem-maintenance folder-context rebuild --project <path> [--dry-run]`);
}

async function main() {
	if (command === "help" || command === "--help" || command === "-h") {
		printUsage();
		return;
	}

	if (command === "reset-db") {
		const config = resolveConfig(projectPath);
		rmSync(config.dbPath, { force: true });
		rmSync(`${config.dbPath}-wal`, { force: true });
		rmSync(`${config.dbPath}-shm`, { force: true });
		console.log(`Removed database files for ${config.dbPath}`);
		return;
	}

	if (command === "folder-context" && (sub === "clean" || sub === "rebuild")) {
		const dryRun = values["dry-run"] === true;
		if (sub === "clean") {
			const result = await cleanFolderContext(projectPath, dryRun);
			console.log(
				`${dryRun ? "[dry-run] " : ""}Scanned ${result.files.length} AGENTS.md files, changed ${result.changed}.`,
			);
			return;
		}

		Database.enableExtensionSupport();
		const config = resolveConfig(projectPath);
		const db = createDatabase(config.dbPath);
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
			config.folderContextMaxDepth,
			dryRun,
		);
		db.close();
		console.log(
			`${dryRun ? "[dry-run] " : ""}Rebuilt context from ${result.observations} observations, touched ${result.filesTouched} files.`,
		);
		return;
	}

	printUsage();
	process.exitCode = 1;
}

main();
