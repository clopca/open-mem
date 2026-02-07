// =============================================================================
// open-mem — Plugin Entry Point
// =============================================================================

import { ObservationCompressor } from "./ai/compressor";
import { createEmbeddingModel } from "./ai/provider";
import { SessionSummarizer } from "./ai/summarizer";
import { ensureDbDirectory, resolveConfig, validateConfig } from "./config";
import { DaemonManager } from "./daemon/manager";
import { createDatabase } from "./db/database";
import { ObservationRepository } from "./db/observations";
import { PendingMessageRepository } from "./db/pending";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { type MemoryEventBus, createEventBus } from "./events/bus";
import { createChatCaptureHook } from "./hooks/chat-capture";
import { createCompactionHook } from "./hooks/compaction";
import { createContextInjectionHook } from "./hooks/context-inject";
import { createEventHandler } from "./hooks/session-events";
import { createToolCaptureHook } from "./hooks/tool-capture";
import { QueueProcessor } from "./queue/processor";
import { createDashboardApp } from "./servers/http-server";
import { SSEBroadcaster, createSSERoute } from "./servers/sse-broadcaster";
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

	// 6. Daemon mode (opt-in)
	let daemonManager: DaemonManager | null = null;
	let daemonLivenessTimer: ReturnType<typeof setInterval> | null = null;

	if (config.daemonEnabled) {
		const { join } = await import("node:path");
		daemonManager = new DaemonManager({
			dbPath: config.dbPath,
			projectPath,
			daemonScript: join(__dirname, "daemon.ts"),
		});

		const started = daemonManager.start();
		if (started) {
			queue.setMode("enqueue-only");
			console.log("[open-mem] Background daemon started — processing delegated");

			daemonLivenessTimer = setInterval(() => {
				if (daemonManager && !daemonManager.isRunning()) {
					console.warn("[open-mem] Daemon died, falling back to in-process processing");
					queue.setMode("in-process");
					queue.start();
					if (daemonLivenessTimer) {
						clearInterval(daemonLivenessTimer);
						daemonLivenessTimer = null;
					}
				}
			}, 30_000);
		} else {
			console.warn("[open-mem] Daemon failed to start — using in-process processing");
			daemonManager = null;
		}
	}

	// 7. Dashboard (opt-in)
	let dashboardServer: ReturnType<typeof Bun.serve> | null = null;
	let eventBus: MemoryEventBus | null = null;
	let sseBroadcaster: SSEBroadcaster | null = null;

	if (config.dashboardEnabled) {
		eventBus = createEventBus();
		sseBroadcaster = new SSEBroadcaster(eventBus);

		const app = createDashboardApp({
			observationRepo,
			sessionRepo,
			summaryRepo,
			config,
			projectPath,
			embeddingModel,
			sseHandler: createSSERoute(sseBroadcaster),
		});

		const basePort = config.dashboardPort;
		let port = basePort;
		let started = false;

		for (let offset = 0; offset < 10; offset++) {
			port = basePort + offset;
			try {
				dashboardServer = Bun.serve({
					port,
					hostname: "127.0.0.1",
					fetch: app.fetch,
				});
				started = true;
				break;
			} catch {}
		}

		if (started) {
			console.log(`[open-mem] Dashboard available at http://127.0.0.1:${port}`);
		} else {
			console.warn(
				`[open-mem] Could not start dashboard — ports ${basePort}-${basePort + 9} all busy`,
			);
		}

		// Wire event bus to observation creates
		const bus = eventBus;
		const originalCreate = observationRepo.create.bind(observationRepo);
		observationRepo.create = (...args: Parameters<typeof observationRepo.create>) => {
			const obs = originalCreate(...args);
			bus.emit("observation:created", obs);
			return obs;
		};
	}

	// 8. Shutdown handler
	const cleanup = () => {
		if (daemonLivenessTimer) clearInterval(daemonLivenessTimer);
		if (daemonManager) daemonManager.stop();
		queue.stop();
		if (dashboardServer) dashboardServer.stop();
		if (sseBroadcaster) sseBroadcaster.destroy();
		db.close();
	};
	process.on("beforeExit", cleanup);

	// 9. Build hooks
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
