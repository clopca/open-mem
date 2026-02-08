#!/usr/bin/env bun
// =============================================================================
// open-mem — MCP Server Entry Point
// =============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createEmbeddingModel, createModel } from "./ai/provider";
import { resolveConfig } from "./config";
import { DefaultMemoryEngine } from "./core/memory-engine";
import { Database, createDatabase } from "./db/database";
import { EntityRepository } from "./db/entities";
import { ObservationRepository } from "./db/observations";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { UserMemoryDatabase, UserObservationRepository } from "./db/user-memory";
import { SearchOrchestrator } from "./search/orchestrator";
import { createReranker } from "./search/reranker";
import { McpServer } from "./adapters/mcp/server";
import {
	createObservationStore,
	createSessionStore,
	createSummaryStore,
	createUserObservationStore,
} from "./store/sqlite/adapters";
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

Database.enableExtensionSupport();
const db = createDatabase(config.dbPath);
initializeSchema(db, {
	hasVectorExtension: db.hasVectorExtension,
	embeddingDimension: config.embeddingDimension,
});

const sessions = new SessionRepository(db);
const observations = new ObservationRepository(db);
const summaries = new SummaryRepository(db);

let userMemoryDb: UserMemoryDatabase | null = null;
let userObservationRepo: UserObservationRepository | null = null;
if (config.userMemoryEnabled) {
	try {
		userMemoryDb = new UserMemoryDatabase(config.userMemoryDbPath);
		userObservationRepo = new UserObservationRepository(userMemoryDb.database);
	} catch (err) {
		console.error(`[open-mem-mcp] Failed to initialize user-level memory: ${err}`);
	}
}

const providerRequiresKey = config.provider !== "bedrock";
const embeddingModel =
	config.compressionEnabled && (!providerRequiresKey || config.apiKey)
		? createEmbeddingModel({ provider: config.provider, model: config.model, apiKey: config.apiKey })
		: null;

const reranker = createReranker(
	config,
	config.rerankingEnabled && (!providerRequiresKey || config.apiKey)
		? createModel({ provider: config.provider, model: config.model, apiKey: config.apiKey })
		: null,
);

const entityRepo = new EntityRepository(db);

const searchOrchestrator = new SearchOrchestrator(
	observations,
	embeddingModel,
	db.hasVectorExtension,
	reranker,
	userObservationRepo,
	entityRepo,
);

const pkgJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const server = new McpServer({
	memoryEngine: new DefaultMemoryEngine({
		observations: createObservationStore(observations),
		sessions: createSessionStore(sessions),
		summaries: createSummaryStore(summaries),
		searchOrchestrator,
		projectPath,
		config,
		userObservationRepo: createUserObservationStore(userObservationRepo),
	}),
	version: pkgJson.version,
});

let closed = false;
const shutdown = () => {
	if (!closed) {
		closed = true;
		if (userMemoryDb) userMemoryDb.close();
		db.close();
	}
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("beforeExit", () => {
	if (!closed) {
		closed = true;
		if (userMemoryDb) userMemoryDb.close();
		db.close();
	}
});

server.start();
