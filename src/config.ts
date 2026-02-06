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
	provider: "anthropic",
	apiKey: undefined, // Falls back to provider-specific env var
	model: "claude-sonnet-4-20250514",
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
	logLevel: "warn" as const,

	// Context injection customization
	contextShowTokenCosts: true,
	contextObservationTypes: "all" as const,
	contextFullObservationCount: 3,
	maxObservations: 50,
	contextShowLastSummary: true,
};

// -----------------------------------------------------------------------------
// Environment Variable Loading
// -----------------------------------------------------------------------------

function loadFromEnv(): Partial<OpenMemConfig> {
	const env: Partial<OpenMemConfig> = {};

	if (process.env.OPEN_MEM_DB_PATH) env.dbPath = process.env.OPEN_MEM_DB_PATH;
	if (process.env.OPEN_MEM_PROVIDER) env.provider = process.env.OPEN_MEM_PROVIDER;
	if (process.env.ANTHROPIC_API_KEY) env.apiKey = process.env.ANTHROPIC_API_KEY;
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

	return env;
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

	// Resolve API key from provider-specific env vars
	if (!config.apiKey) {
		switch (config.provider) {
			case "anthropic":
				config.apiKey = process.env.ANTHROPIC_API_KEY;
				break;
			case "openai":
				config.apiKey = process.env.OPENAI_API_KEY;
				break;
			case "google":
				config.apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
				break;
			case "bedrock":
				// Bedrock uses AWS credentials, no API key needed
				break;
		}
	}

	// Auto-detect provider if using defaults and no API key is set
	if (config.provider === "anthropic" && !config.apiKey) {
		if (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE) {
			config.provider = "bedrock";
			config.model = `us.anthropic.${config.model}-v1:0`;
		}
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
			`AI compression enabled but no API key found for provider "${config.provider}". Set the appropriate API key env var or disable compression with OPEN_MEM_COMPRESSION=false.`,
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
