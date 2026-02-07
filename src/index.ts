// =============================================================================
// open-mem — Plugin Entry Point
// =============================================================================

import { ObservationCompressor } from "./ai/compressor";
import { createEmbeddingModel } from "./ai/provider";
import { SessionSummarizer } from "./ai/summarizer";
import { ensureDbDirectory, resolveConfig, validateConfig } from "./config";
import { createDatabase } from "./db/database";
import { ObservationRepository } from "./db/observations";
import { PendingMessageRepository } from "./db/pending";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { createChatCaptureHook } from "./hooks/chat-capture";
import { createCompactionHook } from "./hooks/compaction";
import { createContextInjectionHook } from "./hooks/context-inject";
import { createEventHandler } from "./hooks/session-events";
import { createToolCaptureHook } from "./hooks/tool-capture";
import { QueueProcessor } from "./queue/processor";
import { createExportTool } from "./tools/export";
import { createImportTool } from "./tools/import";
import { createRecallTool } from "./tools/recall";
import { createSaveTool } from "./tools/save";
import { createSearchTool } from "./tools/search";
import { createTimelineTool } from "./tools/timeline";
import type { Hooks, PluginInput } from "./types";
import { getCanonicalProjectPath } from "./utils/worktree";

// -----------------------------------------------------------------------------
// Plugin Factory
// -----------------------------------------------------------------------------

export default async function plugin(input: PluginInput): Promise<Hooks> {
	const projectPath = getCanonicalProjectPath(input.directory);

	// 1. Configuration
	const config = resolveConfig(projectPath);
	const warnings = validateConfig(config);
	for (const w of warnings) {
		console.warn(`[open-mem] ${w}`);
	}

	// 2. Database
	await ensureDbDirectory(config);
	const db = createDatabase(config.dbPath);
	initializeSchema(db);

	// 3. Repositories
	const sessionRepo = new SessionRepository(db);
	const observationRepo = new ObservationRepository(db);
	const summaryRepo = new SummaryRepository(db);
	const pendingRepo = new PendingMessageRepository(db);

	// 4. AI services
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

	// 5. Queue processor
	const queue = new QueueProcessor(
		config,
		compressor,
		summarizer,
		pendingRepo,
		observationRepo,
		sessionRepo,
		summaryRepo,
		embeddingModel,
	);
	queue.start();

	// 6. Shutdown handler
	const cleanup = () => {
		queue.stop();
		db.close();
	};
	process.on("beforeExit", cleanup);

	// 7. Build hooks
	return {
		"tool.execute.after": createToolCaptureHook(config, queue, sessionRepo, projectPath),
		"chat.message": createChatCaptureHook(observationRepo, sessionRepo, projectPath),
		event: createEventHandler(queue, sessionRepo, projectPath, config, observationRepo),
		"experimental.chat.system.transform": createContextInjectionHook(
			config,
			observationRepo,
			sessionRepo,
			summaryRepo,
			projectPath,
		),
		"experimental.session.compacting": createCompactionHook(
			config,
			observationRepo,
			sessionRepo,
			summaryRepo,
			projectPath,
		),
		tools: [
			createSearchTool(observationRepo, summaryRepo, embeddingModel, projectPath),
			createSaveTool(observationRepo, sessionRepo, projectPath),
			createTimelineTool(sessionRepo, summaryRepo, observationRepo, projectPath),
			createRecallTool(observationRepo),
			createExportTool(observationRepo, summaryRepo, sessionRepo, projectPath),
			createImportTool(observationRepo, summaryRepo, sessionRepo, projectPath),
		],
	};
}

// -----------------------------------------------------------------------------
// Re-exports for consumers
// -----------------------------------------------------------------------------

export type {
	OpenMemConfig,
	Observation,
	Session,
	SessionSummary,
} from "./types";
export { resolveConfig, getDefaultConfig } from "./config";
