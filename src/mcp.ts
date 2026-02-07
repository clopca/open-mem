#!/usr/bin/env bun
// =============================================================================
// open-mem — MCP Server Entry Point
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveConfig } from "./config";
import { createDatabase } from "./db/database";
import { ObservationRepository } from "./db/observations";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { McpServer } from "./servers/mcp-server";
import { getCanonicalProjectPath } from "./utils/worktree";

const { values } = parseArgs({
	options: {
		project: { type: "string", short: "p" },
	},
	strict: false,
});

const projectDir = typeof values.project === "string" ? values.project : process.cwd();
const projectPath = getCanonicalProjectPath(projectDir);

const config = resolveConfig(projectPath);

const db = createDatabase(config.dbPath);
initializeSchema(db);

const sessions = new SessionRepository(db);
const observations = new ObservationRepository(db);
const summaries = new SummaryRepository(db);

const pkgJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const server = new McpServer({
	observations,
	sessions,
	summaries,
	projectPath,
	version: pkgJson.version,
});

let closed = false;
const shutdown = () => {
	if (!closed) {
		closed = true;
		db.close();
	}
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", () => {
	if (!closed) {
		closed = true;
		db.close();
	}
});

server.start();
