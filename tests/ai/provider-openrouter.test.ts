// =============================================================================
// open-mem — OpenRouter Provider Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createEmbeddingModel, createModel } from "../../src/ai/provider";
import { getDefaultDimension, resolveConfig } from "../../src/config";

describe("OpenRouter provider", () => {
	// -------------------------------------------------------------------------
	// createModel
	// -------------------------------------------------------------------------

	test("createModel returns a LanguageModel for openrouter", () => {
		const model = createModel({
			provider: "openrouter",
			model: "google/gemini-2.5-flash-lite",
			apiKey: "test-key",
		});

		expect(model).toBeDefined();
		expect(typeof model).toBe("object");
	});

	// -------------------------------------------------------------------------
	// createEmbeddingModel
	// -------------------------------------------------------------------------

	test("createEmbeddingModel returns null for openrouter", () => {
		const model = createEmbeddingModel({
			provider: "openrouter",
			model: "test",
			apiKey: "test-key",
		});

		expect(model).toBeNull();
	});

	// -------------------------------------------------------------------------
	// getDefaultDimension
	// -------------------------------------------------------------------------

	test("getDefaultDimension returns 0 for openrouter", () => {
		expect(getDefaultDimension("openrouter")).toBe(0);
	});
});

describe("OpenRouter config auto-detection", () => {
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		savedEnv = { ...process.env };
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) delete process.env[key];
		}
		Object.assign(process.env, savedEnv);
	});

	test("resolveConfig auto-detects OPENROUTER_API_KEY", () => {
		delete process.env.OPEN_MEM_PROVIDER;
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_PROFILE;
		process.env.OPENROUTER_API_KEY = "sk-or-test-key-123";

		const config = resolveConfig("/tmp/proj");

		expect(config.provider).toBe("openrouter");
		expect(config.apiKey).toBe("sk-or-test-key-123");
	});

	test("resolveConfig sets default model for openrouter", () => {
		delete process.env.OPEN_MEM_PROVIDER;
		delete process.env.OPEN_MEM_MODEL;
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_PROFILE;
		process.env.OPENROUTER_API_KEY = "sk-or-test-key-123";

		const config = resolveConfig("/tmp/proj");

		expect(config.model).toBe("google/gemini-2.5-flash-lite");
	});

	test("resolveConfig preserves custom model for openrouter", () => {
		delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		delete process.env.GEMINI_API_KEY;
		delete process.env.ANTHROPIC_API_KEY;
		delete process.env.AWS_BEARER_TOKEN_BEDROCK;
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_PROFILE;
		process.env.OPEN_MEM_PROVIDER = "openrouter";
		process.env.OPEN_MEM_MODEL = "anthropic/claude-sonnet-4";
		process.env.OPENROUTER_API_KEY = "sk-or-test-key-123";

		const config = resolveConfig("/tmp/proj");

		expect(config.model).toBe("anthropic/claude-sonnet-4");
	});
});
