// =============================================================================
// open-mem — Plugin Entry Point
// =============================================================================

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenCodeTools } from "./adapters/opencode/tools";
import { ObservationCompressor } from "./ai/compressor";
import { ConflictEvaluator } from "./ai/conflict-evaluator";
import { EntityExtractor } from "./ai/entity-extractor";
import { createEmbeddingModel, createModel } from "./ai/provider";
import { SessionSummarizer } from "./ai/summarizer";
import { ensureDbDirectory, resolveConfig, validateConfig } from "./config";
import { DefaultMemoryEngine } from "./core/memory-engine";
import { DaemonManager } from "./daemon/manager";
import { reapOrphanDaemons } from "./daemon/reaper";
import { Database, createDatabase } from "./db/database";
import { EntityRepository } from "./db/entities";
import { ObservationRepository } from "./db/observations";
import { PendingMessageRepository } from "./db/pending";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { UserMemoryDatabase, UserObservationRepository } from "./db/user-memory";
import { type MemoryEventBus, createEventBus } from "./events/bus";
import { createChatCaptureHook } from "./hooks/chat-capture";
import { createCompactionHook } from "./hooks/compaction";
import { createContextInjectionHook } from "./hooks/context-inject";
import { createEventHandler } from "./hooks/session-events";
import { createToolCaptureHook } from "./hooks/tool-capture";
import { QueueProcessor } from "./queue/processor";
import { createQueueRuntime } from "./runtime/queue-runtime";
import { SearchOrchestrator } from "./search/orchestrator";
import { createReranker } from "./search/reranker";
import { createDashboardApp } from "./adapters/http/server";
import { SSEBroadcaster, createSSERoute } from "./adapters/http/sse";
import {
	createObservationStore,
	createSessionStore,
	createSummaryStore,
	createUserObservationStore,
} from "./store/sqlite/adapters";
import type { Hooks, PluginInput } from "./types";
import { getCanonicalProjectPath } from "./utils/worktree";

// -----------------------------------------------------------------------------
// Path Resolution
// -----------------------------------------------------------------------------

/**
 * Resolve the dist directory at runtime. Handles three execution contexts:
 * 1. Dev mode — running src/index.ts directly (import.meta.url works)
 * 2. Bundle mode — running dist/index.js as a file (import.meta.url works)
 * 3. Eval context — OpenCode loading the bundled plugin via eval
 *    (import.meta.url resolves to file:///path/to/[eval], which is useless)
 */
function getDistDir(): string {
	// Try 1: import.meta.url (works when running as a file, not eval)
	try {
		const url = import.meta.url;
		if (url && !url.includes("[eval]")) {
			const dir = dirname(fileURLToPath(url));
			return dir.endsWith("dist") || dir.endsWith("dist/") || dir.endsWith("dist\\")
				? dir
				: join(dir, "..", "dist");
		}
	} catch {}

	// Try 2: Scan known install locations (works in OpenCode eval context)
	const candidates = [
		join(process.env.HOME || "", ".config", "opencode", "node_modules", "open-mem", "dist"),
		join(process.cwd(), "node_modules", "open-mem", "dist"),
	];
	for (const dir of candidates) {
		if (existsSync(join(dir, "daemon.js"))) return dir;
	}

	// Fallback: best-guess based on CWD
	return join(process.cwd(), "node_modules", "open-mem", "dist");
}

// -----------------------------------------------------------------------------
// Plugin Factory
// -----------------------------------------------------------------------------

/**
 * Main open-mem plugin entry point.
 * Initializes the database, hooks, tools, and context injection pipeline.
 */
export default async function plugin(input: PluginInput): Promise<Hooks> {
	const distDir = getDistDir();
	const projectPath = getCanonicalProjectPath(input.directory);

	// 1. Configuration
	const config = resolveConfig(projectPath);
	const warnings = validateConfig(config);
	for (const w of warnings) {
		console.warn(`[open-mem] ${w}`);
	}

	// 2. Database
	await ensureDbDirectory(config);
	Database.enableExtensionSupport();
	const db = createDatabase(config.dbPath);
	initializeSchema(db, {
		hasVectorExtension: db.hasVectorExtension,
		embeddingDimension: config.embeddingDimension,
	});

	// 3. Repositories
	const sessionRepo = new SessionRepository(db);
	const observationRepo = new ObservationRepository(db);
	const summaryRepo = new SummaryRepository(db);
	const pendingRepo = new PendingMessageRepository(db);

	// 3b. User-level memory (cross-project)
	let userMemoryDb: UserMemoryDatabase | null = null;
	let userObservationRepo: UserObservationRepository | null = null;
	if (config.userMemoryEnabled) {
		try {
			userMemoryDb = new UserMemoryDatabase(config.userMemoryDbPath);
			userObservationRepo = new UserObservationRepository(userMemoryDb.database);
		} catch (err) {
			console.warn(`[open-mem] Failed to initialize user-level memory: ${err}`);
		}
	}

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
	const conflictEvaluator =
		config.conflictResolutionEnabled && (!providerRequiresKey || config.apiKey)
			? new ConflictEvaluator({
					provider: config.provider,
					apiKey: config.apiKey,
					model: config.model,
					rateLimitingEnabled: config.rateLimitingEnabled,
				})
			: null;

	const entityExtractor =
		config.entityExtractionEnabled && (!providerRequiresKey || config.apiKey)
			? new EntityExtractor({
					provider: config.provider,
					apiKey: config.apiKey,
					model: config.model,
					rateLimitingEnabled: config.rateLimitingEnabled,
				})
			: null;
	const entityRepo = new EntityRepository(db);

	const queue = new QueueProcessor(
		config,
		compressor,
		summarizer,
		pendingRepo,
		observationRepo,
		sessionRepo,
		summaryRepo,
		embeddingModel,
		conflictEvaluator,
		entityExtractor,
		entityRepo,
	);
	const queueRuntime = createQueueRuntime(queue);
	queueRuntime.start();

	// 5b. Search + memory engine
	const reranker = createReranker(
		config,
		config.rerankingEnabled && (!providerRequiresKey || config.apiKey)
			? createModel({ provider: config.provider, model: config.model, apiKey: config.apiKey })
			: null,
	);
	const searchOrchestrator = new SearchOrchestrator(
		observationRepo,
		embeddingModel,
		db.hasVectorExtension,
		reranker,
		userObservationRepo,
		entityRepo,
	);
	const memoryEngine = new DefaultMemoryEngine({
		observations: createObservationStore(observationRepo),
		sessions: createSessionStore(sessionRepo),
		summaries: createSummaryStore(summaryRepo),
		searchOrchestrator,
		projectPath,
		config,
		userObservationRepo: createUserObservationStore(userObservationRepo),
	});
	const openCodeTools = createOpenCodeTools(memoryEngine);

	// 6. Daemon mode (opt-in)
	let daemonManager: DaemonManager | null = null;
	let daemonLivenessTimer: ReturnType<typeof setInterval> | null = null;

	if (config.daemonEnabled) {
		reapOrphanDaemons(config.dbPath);

		daemonManager = new DaemonManager({
			dbPath: config.dbPath,
			projectPath,
			daemonScript: join(distDir, "daemon.js"),
		});

		const started = daemonManager.start();
		if (started) {
			queueRuntime.setEnqueueOnly(() => daemonManager?.signal("PROCESS_NOW"));
			console.log("[open-mem] Background daemon started — processing delegated");

			daemonLivenessTimer = setInterval(() => {
				if (daemonManager && !daemonManager.isRunning()) {
					console.warn("[open-mem] Daemon died, falling back to in-process processing");
					queueRuntime.setInProcess();
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
			config,
			projectPath,
			embeddingModel,
			memoryEngine,
			sseHandler: createSSERoute(sseBroadcaster),
			dashboardDir: join(distDir, "dashboard"),
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
					// Keep long-running dashboard requests/SSE streams from timing out at Bun's default 10s.
					idleTimeout: 0,
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
		queueRuntime.stop();
		if (dashboardServer) dashboardServer.stop();
		if (sseBroadcaster) sseBroadcaster.destroy();
		if (userMemoryDb) userMemoryDb.close();
		db.close();
	};
	process.on("beforeExit", cleanup);

	// 9. Build hooks
	return {
		"tool.execute.after": createToolCaptureHook(config, queue, sessionRepo, projectPath),
		"chat.message": createChatCaptureHook(
			observationRepo,
			sessionRepo,
			projectPath,
			config.sensitivePatterns,
		),
		event: createEventHandler(
			queue,
			sessionRepo,
			projectPath,
			config,
			observationRepo,
			pendingRepo,
		),
		"experimental.chat.system.transform": createContextInjectionHook(
			config,
			observationRepo,
			sessionRepo,
			summaryRepo,
			projectPath,
			userObservationRepo,
		),
		"experimental.session.compacting": createCompactionHook(
			config,
			observationRepo,
			sessionRepo,
			summaryRepo,
			projectPath,
			userObservationRepo,
		),
		tool: {
			...openCodeTools,
		},
	};
}

// -----------------------------------------------------------------------------
// Re-exports for consumers
// -----------------------------------------------------------------------------

/** Re-exported core types for library consumers. */
export type {
	OpenMemConfig,
	Observation,
	Session,
	SessionSummary,
} from "./types";
/** Re-exported configuration helpers. */
export { resolveConfig, getDefaultConfig } from "./config";
