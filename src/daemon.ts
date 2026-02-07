#!/usr/bin/env bun
// =============================================================================
// open-mem — Background Daemon Entry Point
// =============================================================================

import { parseArgs } from "node:util";
import { ObservationCompressor } from "./ai/compressor";
import { createEmbeddingModel } from "./ai/provider";
import { SessionSummarizer } from "./ai/summarizer";
import { resolveConfig } from "./config";
import { getPidPath, removePid, writePid } from "./daemon/pid";
import { DaemonWorker } from "./daemon/worker";
import { Database, createDatabase } from "./db/database";
import { ObservationRepository } from "./db/observations";
import { PendingMessageRepository } from "./db/pending";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { QueueProcessor } from "./queue/processor";
import { getCanonicalProjectPath } from "./utils/worktree";

// -----------------------------------------------------------------------------
// CLI Arguments
// -----------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 5000;

const { values } = parseArgs({
	options: {
		project: { type: "string", short: "p" },
		"poll-interval": { type: "string" },
	},
	strict: false,
});

const projectDir = typeof values.project === "string" ? values.project : null;
if (!projectDir) {
	console.error("Usage: open-mem-daemon --project <path> [--poll-interval <ms>]");
	process.exit(1);
}

const rawInterval = values["poll-interval"];
const pollIntervalMs =
	typeof rawInterval === "string" ? Number.parseInt(rawInterval, 10) : DEFAULT_POLL_INTERVAL_MS;

if (Number.isNaN(pollIntervalMs) || pollIntervalMs < 100) {
	console.error("--poll-interval must be a number >= 100");
	process.exit(1);
}

// -----------------------------------------------------------------------------
// Initialize
// -----------------------------------------------------------------------------

const projectPath = getCanonicalProjectPath(projectDir);
const config = resolveConfig(projectPath);

Database.enableExtensionSupport();
const db = createDatabase(config.dbPath);
initializeSchema(db, {
	hasVectorExtension: db.hasVectorExtension,
	embeddingDimension: config.embeddingDimension,
});

const pendingRepo = new PendingMessageRepository(db);
const observationRepo = new ObservationRepository(db);
const sessionRepo = new SessionRepository(db);
const summaryRepo = new SummaryRepository(db);

const compressor = new ObservationCompressor(config);
const summarizer = new SessionSummarizer(config);

const providerRequiresKey = config.provider !== "bedrock";
const embeddingModel =
	config.compressionEnabled && (!providerRequiresKey || config.apiKey)
		? createEmbeddingModel({
				provider: config.provider,
				model: config.model,
				apiKey: config.apiKey,
			})
		: null;

const queueProcessor = new QueueProcessor(
	config,
	compressor,
	summarizer,
	pendingRepo,
	observationRepo,
	sessionRepo,
	summaryRepo,
	embeddingModel,
);

const pidPath = getPidPath(config.dbPath);
writePid(pidPath);

const worker = new DaemonWorker({ queueProcessor, pollIntervalMs });

// -----------------------------------------------------------------------------
// IPC from parent process
// -----------------------------------------------------------------------------

if (process.send) {
	process.on("message", (msg: unknown) => {
		worker.handleMessage(msg);
	});
}

// -----------------------------------------------------------------------------
// Shutdown handlers
// -----------------------------------------------------------------------------

let closed = false;
const shutdown = () => {
	if (closed) return;
	closed = true;
	worker.stop();
	removePid(pidPath);
	db.close();
};

process.on("SIGTERM", () => {
	shutdown();
	process.exit(0);
});
process.on("SIGINT", () => {
	shutdown();
	process.exit(0);
});
process.on("beforeExit", shutdown);

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------

worker.start();
