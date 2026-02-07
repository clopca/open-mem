// =============================================================================
// open-mem — Configuration Management
// =============================================================================

import type { ObservationType, OpenMemConfig } from "./types";

// -----------------------------------------------------------------------------
// Default Configuration
// -----------------------------------------------------------------------------

const DEFAULT_CONFIG: OpenMemConfig = {
	// Storage — default to project-local .open-mem directory
	dbPath: ".open-mem/memory.db",

	// AI
	provider: "google",
	apiKey: undefined, // Falls back to provider-specific env var
	model: "gemini-2.5-flash-lite",
	maxTokensPerCompression: 1024,

	// Behavior
	compressionEnabled: true,
	contextInjectionEnabled: true,
	maxContextTokens: 4000,
	batchSize: 5,
	batchIntervalMs: 30_000, // 30 seconds

	// Filtering
	ignoredTools: [],
	minOutputLength: 50,

	// Progressive disclosure
	maxIndexEntries: 20,

	// Privacy
	sensitivePatterns: [],

	// Data retention
	retentionDays: 90, // Keep 90 days by default
	maxDatabaseSizeMb: 500, // 500MB max by default

	// Logging
	logLevel: "warn",

	// Context injection customization
	contextShowTokenCosts: true,
	contextObservationTypes: "all",
	contextFullObservationCount: 3,
	maxObservations: 50,
	contextShowLastSummary: true,

	// Rate limiting
	rateLimitingEnabled: true,

	// Folder context
	folderContextEnabled: true,
	folderContextMaxDepth: 5,

	// Daemon
	daemonEnabled: false,

	// Dashboard
	dashboardEnabled: false,
	dashboardPort: 3737,

	// Embeddings
	embeddingDimension: undefined,
};

// -----------------------------------------------------------------------------
// Environment Variable Loading
// -----------------------------------------------------------------------------

function loadFromEnv(): Partial<OpenMemConfig> {
	const env: Partial<OpenMemConfig> = {};

	if (process.env.OPEN_MEM_DB_PATH) env.dbPath = process.env.OPEN_MEM_DB_PATH;
	if (process.env.OPEN_MEM_PROVIDER) env.provider = process.env.OPEN_MEM_PROVIDER;
	// API key loaded later in resolveConfig based on resolved provider
	if (process.env.OPEN_MEM_MODEL) env.model = process.env.OPEN_MEM_MODEL;
	if (process.env.OPEN_MEM_MAX_CONTEXT_TOKENS)
		env.maxContextTokens = Number.parseInt(process.env.OPEN_MEM_MAX_CONTEXT_TOKENS, 10);
	if (process.env.OPEN_MEM_COMPRESSION === "false") env.compressionEnabled = false;
	if (process.env.OPEN_MEM_CONTEXT_INJECTION === "false") env.contextInjectionEnabled = false;
	if (process.env.OPEN_MEM_IGNORED_TOOLS)
		env.ignoredTools = process.env.OPEN_MEM_IGNORED_TOOLS.split(",").map((s) => s.trim());
	if (process.env.OPEN_MEM_BATCH_SIZE)
		env.batchSize = Number.parseInt(process.env.OPEN_MEM_BATCH_SIZE, 10);
	if (process.env.OPEN_MEM_RETENTION_DAYS)
		env.retentionDays = Number.parseInt(process.env.OPEN_MEM_RETENTION_DAYS, 10);
	if (process.env.OPEN_MEM_LOG_LEVEL)
		env.logLevel = process.env.OPEN_MEM_LOG_LEVEL as OpenMemConfig["logLevel"];
	if (process.env.OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS === "false") env.contextShowTokenCosts = false;
	if (process.env.OPEN_MEM_CONTEXT_TYPES)
		env.contextObservationTypes =
			process.env.OPEN_MEM_CONTEXT_TYPES === "all"
				? "all"
				: (process.env.OPEN_MEM_CONTEXT_TYPES.split(",").map((s) => s.trim()) as ObservationType[]);
	if (process.env.OPEN_MEM_CONTEXT_FULL_COUNT)
		env.contextFullObservationCount = Number.parseInt(process.env.OPEN_MEM_CONTEXT_FULL_COUNT, 10);
	if (process.env.OPEN_MEM_MAX_OBSERVATIONS)
		env.maxObservations = Number.parseInt(process.env.OPEN_MEM_MAX_OBSERVATIONS, 10);
	if (process.env.OPEN_MEM_CONTEXT_SHOW_LAST_SUMMARY === "false")
		env.contextShowLastSummary = false;
	if (process.env.OPEN_MEM_RATE_LIMITING === "false") env.rateLimitingEnabled = false;
	if (process.env.OPEN_MEM_FOLDER_CONTEXT === "false") env.folderContextEnabled = false;
	if (process.env.OPEN_MEM_FOLDER_CONTEXT_MAX_DEPTH)
		env.folderContextMaxDepth = Number.parseInt(process.env.OPEN_MEM_FOLDER_CONTEXT_MAX_DEPTH, 10);
	if (process.env.OPEN_MEM_DAEMON === "true") env.daemonEnabled = true;
	if (process.env.OPEN_MEM_DASHBOARD === "true") env.dashboardEnabled = true;
	if (process.env.OPEN_MEM_DASHBOARD_PORT)
		env.dashboardPort = Number.parseInt(process.env.OPEN_MEM_DASHBOARD_PORT, 10);
	if (process.env.OPEN_MEM_EMBEDDING_DIMENSION)
		env.embeddingDimension = Number.parseInt(process.env.OPEN_MEM_EMBEDDING_DIMENSION, 10);

	return env;
}

// -----------------------------------------------------------------------------
// Embedding Dimension Defaults
// -----------------------------------------------------------------------------

export function getDefaultDimension(provider: string): number {
	switch (provider) {
		case "google":
			return 768;
		case "openai":
			return 1536;
		case "bedrock":
			return 1024;
		case "anthropic":
			return 0;
		default:
			return 768;
	}
}

// -----------------------------------------------------------------------------
// Config Resolution
// -----------------------------------------------------------------------------

/**
 * Resolve configuration by merging defaults, environment variables, and overrides.
 * Priority: defaults < env vars < overrides
 */
export function resolveConfig(
	projectDir: string,
	overrides?: Partial<OpenMemConfig>,
): OpenMemConfig {
	const envConfig = loadFromEnv();

	const config: OpenMemConfig = {
		...DEFAULT_CONFIG,
		...envConfig,
		...overrides,
	};

	// Resolve relative dbPath against project directory
	if (!config.dbPath.startsWith("/")) {
		config.dbPath = `${projectDir}/${config.dbPath}`;
	}

	// Auto-detect provider from available env credentials (when not explicitly set)
	if (!process.env.OPEN_MEM_PROVIDER && !overrides?.provider) {
		if (process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY) {
			config.provider = "google";
		} else if (process.env.ANTHROPIC_API_KEY) {
			config.provider = "anthropic";
		} else if (
			process.env.AWS_BEARER_TOKEN_BEDROCK ||
			process.env.AWS_ACCESS_KEY_ID ||
			process.env.AWS_PROFILE
		) {
			config.provider = "bedrock";
		}
		// else: keep default ("google")
	}

	// Resolve API key from provider-specific env vars
	if (!config.apiKey) {
		switch (config.provider) {
			case "google":
				config.apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
				break;
			case "anthropic":
				config.apiKey = process.env.ANTHROPIC_API_KEY;
				break;
			case "openai":
				config.apiKey = process.env.OPENAI_API_KEY;
				break;
			case "bedrock":
				break;
		}
	}

	if (config.embeddingDimension === undefined) {
		config.embeddingDimension = getDefaultDimension(config.provider);
	}

	return config;
}

// -----------------------------------------------------------------------------
// Config Validation
// -----------------------------------------------------------------------------

/**
 * Validate a resolved configuration. Returns an array of error messages.
 * An empty array means the configuration is valid.
 */
export function validateConfig(config: OpenMemConfig): string[] {
	const errors: string[] = [];

	const providerRequiresKey = config.provider !== "bedrock";
	if (config.compressionEnabled && providerRequiresKey && !config.apiKey) {
		errors.push(
			"AI compression enabled but no API key found. Get a free Gemini API key at https://aistudio.google.com/apikey and set GOOGLE_GENERATIVE_AI_API_KEY, or set OPEN_MEM_PROVIDER and the appropriate API key for your provider.",
		);
	}

	if (config.maxContextTokens < 500) {
		errors.push("maxContextTokens must be at least 500");
	}

	if (config.batchSize < 1) {
		errors.push("batchSize must be at least 1");
	}

	if (config.minOutputLength < 0) {
		errors.push("minOutputLength must be non-negative");
	}

	return errors;
}

// -----------------------------------------------------------------------------
// Convenience Functions
// -----------------------------------------------------------------------------

/** Get a copy of the default configuration */
export function getDefaultConfig(): OpenMemConfig {
	return { ...DEFAULT_CONFIG };
}

/** Ensure the database directory exists */
export async function ensureDbDirectory(config: OpenMemConfig): Promise<void> {
	const dir = config.dbPath.substring(0, config.dbPath.lastIndexOf("/"));
	const { mkdir } = await import("node:fs/promises");
	await mkdir(dir, { recursive: true });
}
