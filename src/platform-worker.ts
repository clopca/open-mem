import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
	createClaudeCodeAdapter,
	createCursorAdapter,
	PlatformIngestionRuntime,
	type PlatformName,
} from "./adapters/platform";
import { ObservationCompressor } from "./ai/compressor";
import { ConflictEvaluator } from "./ai/conflict-evaluator";
import { EntityExtractor } from "./ai/entity-extractor";
import { createEmbeddingModel } from "./ai/provider";
import { SessionSummarizer } from "./ai/summarizer";
import { resolveConfig } from "./config";
import { createDatabase, Database } from "./db/database";
import { EntityRepository } from "./db/entities";
import { ObservationRepository } from "./db/observations";
import { PendingMessageRepository } from "./db/pending";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { SummaryRepository } from "./db/summaries";
import { QueueProcessor } from "./queue/processor";
import { getCanonicalProjectPath } from "./utils/worktree";

interface WorkerState {
	db: Database;
	queue: QueueProcessor;
	runtime: PlatformIngestionRuntime;
	platform: PlatformName;
	projectPath: string;
}

interface WorkerArgs {
	projectDir: string;
	httpPort?: number;
}

type BridgeCommand = "event" | "flush" | "health" | "shutdown";

interface BridgeEnvelope {
	id?: string | number;
	command?: BridgeCommand;
	payload?: unknown;
}

interface BridgeResponse {
	id?: string | number;
	ok: boolean;
	code: string;
	message?: string;
	ingested?: boolean;
	processed?: number;
	status?: {
		platform: PlatformName;
		projectPath: string;
		queue: {
			mode: string;
			running: boolean;
			processing: boolean;
			pending: number;
		};
	};
}

function writeResponse(resp: BridgeResponse): void {
	process.stdout.write(`${JSON.stringify(resp)}\n`);
}

function parseWorkerArgs(): WorkerArgs {
	const { values } = parseArgs({
		options: {
			project: { type: "string", short: "p" },
			"http-port": { type: "string" },
		},
		strict: false,
	});
	const projectDir = typeof values.project === "string" ? values.project : process.cwd();
	const rawHttpPort = values["http-port"];
	const httpPort =
		typeof rawHttpPort === "string" && Number.parseInt(rawHttpPort, 10) > 0
			? Number.parseInt(rawHttpPort, 10)
			: undefined;
	return { projectDir, httpPort };
}

function assertAdapterEnabled(
	platform: PlatformName,
	config: ReturnType<typeof resolveConfig>,
): void {
	if (platform === "claude-code" && !config.platformClaudeCodeEnabled) {
		throw new Error("Claude Code adapter is disabled. Set OPEN_MEM_PLATFORM_CLAUDE_CODE=true.");
	}
	if (platform === "cursor" && !config.platformCursorEnabled) {
		throw new Error("Cursor adapter is disabled. Set OPEN_MEM_PLATFORM_CURSOR=true.");
	}
}

function initialize(platform: PlatformName, projectDir: string): WorkerState {
	const projectPath = getCanonicalProjectPath(projectDir);
	const config = resolveConfig(projectPath);
	assertAdapterEnabled(platform, config);

	Database.enableExtensionSupport();
	const db = createDatabase(config.dbPath);
	initializeSchema(db, {
		hasVectorExtension: db.hasVectorExtension,
		embeddingDimension: config.embeddingDimension,
	});

	const sessions = new SessionRepository(db);
	const observations = new ObservationRepository(db);
	const summaries = new SummaryRepository(db);
	const pending = new PendingMessageRepository(db);

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
		pending,
		observations,
		sessions,
		summaries,
		embeddingModel,
		conflictEvaluator,
		entityExtractor,
		entityRepo,
	);

	const adapter = platform === "claude-code" ? createClaudeCodeAdapter() : createCursorAdapter();
	const runtime = new PlatformIngestionRuntime({
		adapter,
		queue,
		sessions,
		observations,
		pendingMessages: pending,
		projectPath,
		config,
	});
	return { db, queue, runtime, platform, projectPath };
}

function healthResponse(state: WorkerState, id?: string | number): BridgeResponse {
	const queueStats = state.queue.getStats();
	return {
		id,
		ok: true,
		code: "OK",
		status: {
			platform: state.platform,
			projectPath: state.projectPath,
			queue: {
				mode: state.queue.getMode(),
				running: state.queue.isRunning,
				processing: queueStats.processing,
				pending: queueStats.pending,
			},
		},
	};
}

function parseEnvelope(value: unknown): BridgeEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { command: "event", payload: value };
	}
	const obj = value as Record<string, unknown>;
	const command =
		typeof obj.command === "string" &&
		(obj.command === "event" ||
			obj.command === "flush" ||
			obj.command === "health" ||
			obj.command === "shutdown")
			? obj.command
			: undefined;
	const id = typeof obj.id === "string" || typeof obj.id === "number" ? obj.id : undefined;
	if (!command) {
		return { command: "event", payload: value, id };
	}
	return {
		id,
		command,
		payload: "payload" in obj ? obj.payload : undefined,
	};
}

export async function runPlatformWorker(platform: PlatformName): Promise<void> {
	const args = parseWorkerArgs();
	const state = initialize(platform, args.projectDir);
	state.queue.start();

	let shuttingDown = false;
	const shutdown = async () => {
		if (shuttingDown) return;
		shuttingDown = true;
		try {
			await state.queue.processBatch();
		} catch {}
		state.queue.stop();
		state.db.close();
		process.exit(0);
	};

	const handleEnvelope = async (envelope: BridgeEnvelope): Promise<BridgeResponse> => {
		const command = envelope.command ?? "event";
		if (command === "health") return healthResponse(state, envelope.id);
		if (command === "flush") {
			const processed = await state.queue.processBatch();
			return { id: envelope.id, ok: true, code: "OK", processed };
		}
		if (command === "shutdown") {
			return { id: envelope.id, ok: true, code: "OK", message: "shutting down" };
		}
		const ingested = await state.runtime.ingestRaw(envelope.payload);
		if (!ingested) {
			return {
				id: envelope.id,
				ok: false,
				code: "UNSUPPORTED_EVENT",
				message: "Payload did not match adapter event schema",
			};
		}
		return { id: envelope.id, ok: true, code: "OK", ingested: true };
	};

	if (args.httpPort) {
		Bun.serve({
			port: args.httpPort,
			hostname: "127.0.0.1",
			idleTimeout: 0,
			fetch: async (req) => {
				if (req.method === "GET" && new URL(req.url).pathname === "/v1/health") {
					return Response.json(healthResponse(state));
				}
				if (req.method === "POST" && new URL(req.url).pathname === "/v1/events") {
					let body: unknown;
					try {
						body = await req.json();
					} catch {
						return Response.json(
							{ ok: false, code: "INVALID_JSON", message: "Invalid JSON payload" },
							{ status: 400 },
						);
					}
					try {
						const response = await handleEnvelope(parseEnvelope(body));
						if ((parseEnvelope(body).command ?? "event") === "shutdown") {
							setTimeout(() => {
								void shutdown();
							}, 0);
						}
						return Response.json(response, {
							status: response.ok ? 200 : 422,
						});
					} catch (error) {
						return Response.json(
							{
								ok: false,
								code: "INGESTION_FAILED",
								message: String(error),
							},
							{ status: 500 },
						);
					}
				}
				return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
			},
		});
	}

	process.on("SIGINT", () => {
		void shutdown();
	});
	process.on("SIGTERM", () => {
		void shutdown();
	});

	let lineQueue = Promise.resolve();
	const rl = createInterface({ input: process.stdin, terminal: false });
	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) return;
		lineQueue = lineQueue.then(async () => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				writeResponse({
					ok: false,
					code: "INVALID_JSON",
					message: "Invalid JSON payload",
				});
				return;
			}
			try {
				const envelope = parseEnvelope(parsed);
				const response = await handleEnvelope(envelope);
				writeResponse(response);
				if ((envelope.command ?? "event") === "shutdown") {
					await shutdown();
				}
			} catch (error) {
				writeResponse({
					ok: false,
					code: "INGESTION_FAILED",
					message: String(error),
				});
			}
		});
	});
	rl.on("close", () => {
		void lineQueue.finally(() => shutdown());
	});
}
