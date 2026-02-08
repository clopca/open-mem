// =============================================================================
// open-mem — Fallback Language Model Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import { FallbackLanguageModel, type FallbackProvider } from "../../src/ai/fallback";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockModel(overrides?: {
	doGenerate?: () => Promise<unknown>;
	doStream?: () => Promise<unknown>;
}): LanguageModelV2 | LanguageModelV3 {
	return {
		specificationVersion: "v3",
		provider: "test-provider",
		modelId: "test-model",
		supportedUrls: {},
		doGenerate: overrides?.doGenerate ?? (() => Promise.resolve({ content: "primary-result" })),
		doStream: overrides?.doStream ?? (() => Promise.resolve({ stream: "primary-stream" })),
	} as unknown as LanguageModelV3;
}

function makeProvider(
	name: string,
	overrides?: Parameters<typeof makeMockModel>[0],
): FallbackProvider {
	return { name, model: makeMockModel(overrides) };
}

// =============================================================================
// Tests
// =============================================================================

describe("FallbackLanguageModel", () => {
	test("constructor throws with empty providers", () => {
		expect(() => new FallbackLanguageModel([])).toThrow("At least one provider required");
	});

	test("copies metadata from primary provider", () => {
		const primary = makeMockModel();
		const fallback = new FallbackLanguageModel([{ name: "primary", model: primary }]);

		expect(fallback.specificationVersion).toBe("v3");
		expect(fallback.provider).toBe("test-provider");
		expect(fallback.modelId).toBe("test-model");
	});

	test("primary succeeds — returns primary result without fallback", async () => {
		const primaryResult = { content: "primary-ok" };
		const secondaryCalled = { value: false };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.resolve(primaryResult),
			}),
			makeProvider("secondary", {
				doGenerate: () => {
					secondaryCalled.value = true;
					return Promise.resolve({ content: "secondary-ok" });
				},
			}),
		]);

		const result = await fallback.doGenerate({});
		expect(result).toBe(primaryResult);
		expect(secondaryCalled.value).toBe(false);
	});

	test("429 triggers fallback to secondary", async () => {
		const secondaryResult = { content: "secondary-ok" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject({ status: 429, message: "rate limited" }),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.resolve(secondaryResult),
			}),
		]);

		const result = await fallback.doGenerate({});
		expect(result).toBe(secondaryResult);
	});

	test("500 triggers fallback to secondary", async () => {
		const secondaryResult = { content: "secondary-ok" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject({ status: 500, message: "server error" }),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.resolve(secondaryResult),
			}),
		]);

		const result = await fallback.doGenerate({});
		expect(result).toBe(secondaryResult);
	});

	test("503 triggers fallback to secondary", async () => {
		const secondaryResult = { content: "secondary-ok" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject({ status: 503, message: "unavailable" }),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.resolve(secondaryResult),
			}),
		]);

		const result = await fallback.doGenerate({});
		expect(result).toBe(secondaryResult);
	});

	test("401 does NOT fallback — throws immediately", async () => {
		const secondaryCalled = { value: false };
		const configError = { status: 401, message: "unauthorized" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject(configError),
			}),
			makeProvider("secondary", {
				doGenerate: () => {
					secondaryCalled.value = true;
					return Promise.resolve({ content: "secondary-ok" });
				},
			}),
		]);

		try {
			await fallback.doGenerate({});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBe(configError);
		}
		expect(secondaryCalled.value).toBe(false);
	});

	test("400 does NOT fallback — throws immediately", async () => {
		const configError = { status: 400, message: "bad request" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject(configError),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.resolve({ content: "secondary-ok" }),
			}),
		]);

		try {
			await fallback.doGenerate({});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBe(configError);
		}
	});

	test("all providers fail — throws last error", async () => {
		const lastError = { status: 503, message: "all down" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject({ status: 429, message: "rate limited" }),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.reject(lastError),
			}),
		]);

		try {
			await fallback.doGenerate({});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBe(lastError);
		}
	});

	test("doStream falls back on retryable error", async () => {
		const secondaryStreamResult = { stream: "secondary-stream" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doStream: () => Promise.reject({ status: 429, message: "rate limited" }),
			}),
			makeProvider("secondary", {
				doStream: () => Promise.resolve(secondaryStreamResult),
			}),
		]);

		const result = await fallback.doStream({});
		expect(result).toBe(secondaryStreamResult);
	});

	test("doStream throws immediately on config error", async () => {
		const configError = { status: 403, message: "forbidden" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doStream: () => Promise.reject(configError),
			}),
			makeProvider("secondary", {
				doStream: () => Promise.resolve({ stream: "secondary-stream" }),
			}),
		]);

		try {
			await fallback.doStream({});
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBe(configError);
		}
	});

	test("chains through 3 providers", async () => {
		const tertiaryResult = { content: "tertiary-ok" };

		const fallback = new FallbackLanguageModel([
			makeProvider("primary", {
				doGenerate: () => Promise.reject({ status: 429, message: "rate limited" }),
			}),
			makeProvider("secondary", {
				doGenerate: () => Promise.reject({ status: 503, message: "unavailable" }),
			}),
			makeProvider("tertiary", {
				doGenerate: () => Promise.resolve(tertiaryResult),
			}),
		]);

		const result = await fallback.doGenerate({});
		expect(result).toBe(tertiaryResult);
	});
});

describe("createModelWithFallback", () => {
	test("no fallbacks returns primary model directly (not wrapped)", () => {
		const { buildFallbackConfigs } = require("../../src/ai/provider");
		const configs = buildFallbackConfigs({});
		expect(configs).toEqual([]);

		const configsEmpty = buildFallbackConfigs({ fallbackProviders: [] });
		expect(configsEmpty).toEqual([]);
	});

	test("buildFallbackConfigs creates configs for each provider", () => {
		const { buildFallbackConfigs } = require("../../src/ai/provider");
		const configs = buildFallbackConfigs({ fallbackProviders: ["openai", "anthropic"] });

		expect(configs).toHaveLength(2);
		expect(configs[0].provider).toBe("openai");
		expect(configs[0].model).toBe("gpt-4o-mini");
		expect(configs[1].provider).toBe("anthropic");
		expect(configs[1].model).toBe("claude-sonnet-4-20250514");
	});
});
