import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultConfig, resolveConfig, validateConfig } from "../src/config";
import type { OpenMemConfig } from "../src/types";

describe("Configuration", () => {
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		savedEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore env: remove keys that weren't in the original env
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) delete process.env[key];
		}
		Object.assign(process.env, savedEnv);
	});

	// -------------------------------------------------------------------------
	// getDefaultConfig
	// -------------------------------------------------------------------------

	test("getDefaultConfig returns defaults", () => {
		// Act
		const config = getDefaultConfig();

		// Assert: verify sensible default values
		expect(config.dbPath).toBe(".open-mem/memory.db");
		expect(config.apiKey).toBeUndefined();
		expect(config.model).toBe("gemini-2.5-flash-lite");
		expect(config.maxTokensPerCompression).toBe(1024);
		expect(config.compressionEnabled).toBe(true);
		expect(config.contextInjectionEnabled).toBe(true);
		expect(config.maxContextTokens).toBe(4000);
		expect(config.batchSize).toBe(5);
		expect(config.batchIntervalMs).toBe(30_000);
		expect(config.ignoredTools).toEqual([]);
		expect(config.minOutputLength).toBe(50);
		expect(config.maxIndexEntries).toBe(20);
		expect(config.sensitivePatterns).toEqual([]);
		expect(config.retentionDays).toBe(90);
		expect(config.maxDatabaseSizeMb).toBe(500);
		expect(config.logLevel).toBe("warn");
	});

	// -------------------------------------------------------------------------
	// resolveConfig
	// -------------------------------------------------------------------------

	test("resolveConfig with no overrides", () => {
		// Arrange: clear env vars that could interfere
		delete process.env.OPEN_MEM_DB_PATH;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.OPEN_MEM_PROVIDER;
		delete process.env.OPEN_MEM_MODEL;
		delete process.env.OPEN_MEM_MAX_CONTEXT_TOKENS;
		delete process.env.OPEN_MEM_COMPRESSION;
		delete process.env.OPEN_MEM_CONTEXT_INJECTION;
		delete process.env.OPEN_MEM_IGNORED_TOOLS;
		delete process.env.OPEN_MEM_BATCH_SIZE;
		delete process.env.OPEN_MEM_RETENTION_DAYS;
		delete process.env.OPEN_MEM_LOG_LEVEL;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_PROFILE;
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;

		// Act
		const config = resolveConfig("/tmp/proj");

		// Assert: defaults with resolved dbPath
		expect(config.dbPath).toBe("/tmp/proj/.open-mem/memory.db");
		expect(config.model).toBe("gemini-2.5-flash-lite");
		expect(config.compressionEnabled).toBe(true);
		expect(config.batchSize).toBe(5);
	});

	test("resolveConfig resolves relative dbPath", () => {
		// Arrange
		delete process.env.OPEN_MEM_DB_PATH;
		delete process.env.ANTHROPIC_API_KEY;

		// Act
		const config = resolveConfig("/tmp/proj");

		// Assert: relative path resolved against projectDir
		expect(config.dbPath).toBe("/tmp/proj/.open-mem/memory.db");
	});

	test("resolveConfig preserves absolute dbPath", () => {
		// Arrange
		delete process.env.OPEN_MEM_DB_PATH;
		delete process.env.ANTHROPIC_API_KEY;

		// Act
		const config = resolveConfig("/tmp/proj", {
			dbPath: "/custom/path.db",
		});

		// Assert: absolute path not modified
		expect(config.dbPath).toBe("/custom/path.db");
	});

	test("resolveConfig env vars override defaults", () => {
		// Arrange
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_MODEL = "claude-haiku-3";

		// Act
		const config = resolveConfig("/tmp/proj");

		// Assert: env var value used instead of default
		expect(config.model).toBe("claude-haiku-3");
	});

	test("resolveConfig overrides beat env vars", () => {
		// Arrange
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_MODEL = "claude-haiku-3";

		// Act
		const config = resolveConfig("/tmp/proj", {
			model: "claude-opus-5",
		});

		// Assert: override wins over env var
		expect(config.model).toBe("claude-opus-5");
	});

	test("resolveConfig picks up ANTHROPIC_API_KEY", () => {
		// Arrange: clear all provider env vars so auto-detection picks Anthropic
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_PROFILE;
		delete process.env.OPEN_MEM_PROVIDER;
		process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-123";

		// Act
		const config = resolveConfig("/tmp/proj");

		// Assert: API key populated from env, provider auto-detected
		expect(config.provider).toBe("anthropic");
		expect(config.apiKey).toBe("sk-ant-test-key-123");
	});

	// -------------------------------------------------------------------------
	// validateConfig
	// -------------------------------------------------------------------------

	test("validateConfig no errors for valid config", () => {
		// Arrange: valid config with API key
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			apiKey: "sk-ant-valid-key",
			dbPath: "/tmp/proj/.open-mem/memory.db",
		};

		// Act
		const errors = validateConfig(config);

		// Assert
		expect(errors).toEqual([]);
	});

	test("validateConfig error when compression enabled without key", () => {
		// Arrange: compression enabled but no API key
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			compressionEnabled: true,
			apiKey: undefined,
			dbPath: "/tmp/proj/.open-mem/memory.db",
		};

		// Act
		const errors = validateConfig(config);

		// Assert: error about missing API key
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.toLowerCase().includes("api"))).toBe(true);
	});

	test("validateConfig error for low maxContextTokens", () => {
		// Arrange: maxContextTokens below minimum
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			apiKey: "sk-ant-valid-key",
			maxContextTokens: 100,
			dbPath: "/tmp/proj/.open-mem/memory.db",
		};

		// Act
		const errors = validateConfig(config);

		// Assert: error about minimum
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.toLowerCase().includes("maxcontexttokens"))).toBe(true);
	});

	test("validateConfig error for invalid batchSize", () => {
		// Arrange: batchSize of 0 (below minimum of 1)
		const config: OpenMemConfig = {
			...getDefaultConfig(),
			apiKey: "sk-ant-valid-key",
			batchSize: 0,
			dbPath: "/tmp/proj/.open-mem/memory.db",
		};

		// Act
		const errors = validateConfig(config);

		// Assert: error about minimum
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some((e) => e.toLowerCase().includes("batchsize"))).toBe(true);
	});

	test("OPEN_MEM_IGNORED_TOOLS parsing", () => {
		// Arrange
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_IGNORED_TOOLS = "Bash,Read";

		// Act
		const config = resolveConfig("/tmp/proj");

		// Assert: comma-separated env parsed into array
		expect(config.ignoredTools).toEqual(["Bash", "Read"]);
	});

	// -------------------------------------------------------------------------
	// Context injection config
	// -------------------------------------------------------------------------

	test("getDefaultConfig has context injection fields", () => {
		const config = getDefaultConfig();

		expect(config.contextShowTokenCosts).toBe(true);
		expect(config.contextObservationTypes).toBe("all");
		expect(config.contextFullObservationCount).toBe(3);
		expect(config.maxObservations).toBe(50);
		expect(config.contextShowLastSummary).toBe(true);
	});

	test("OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS=false disables costs", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS = "false";

		const config = resolveConfig("/tmp/proj");

		expect(config.contextShowTokenCosts).toBe(false);
	});

	test("OPEN_MEM_CONTEXT_TYPES parsing", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_CONTEXT_TYPES = "bugfix,discovery";

		const config = resolveConfig("/tmp/proj");

		expect(config.contextObservationTypes).toEqual(["bugfix", "discovery"]);
	});

	test("OPEN_MEM_CONTEXT_TYPES=all keeps string", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_CONTEXT_TYPES = "all";

		const config = resolveConfig("/tmp/proj");

		expect(config.contextObservationTypes).toBe("all");
	});

	test("OPEN_MEM_CONTEXT_FULL_COUNT parsing", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_CONTEXT_FULL_COUNT = "5";

		const config = resolveConfig("/tmp/proj");

		expect(config.contextFullObservationCount).toBe(5);
	});

	test("OPEN_MEM_MAX_OBSERVATIONS parsing", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_MAX_OBSERVATIONS = "100";

		const config = resolveConfig("/tmp/proj");

		expect(config.maxObservations).toBe(100);
	});

	test("OPEN_MEM_CONTEXT_SHOW_LAST_SUMMARY=false disables summary", () => {
		delete process.env.ANTHROPIC_API_KEY;
		process.env.OPEN_MEM_CONTEXT_SHOW_LAST_SUMMARY = "false";

		const config = resolveConfig("/tmp/proj");

		expect(config.contextShowLastSummary).toBe(false);
	});
});
