import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultDimension, resolveConfig } from "../../src/config";

describe("Embedding Dimension Configuration", () => {
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

	describe("getDefaultDimension", () => {
		test("google returns 768", () => {
			expect(getDefaultDimension("google")).toBe(768);
		});

		test("openai returns 1536", () => {
			expect(getDefaultDimension("openai")).toBe(1536);
		});

		test("bedrock returns 1024", () => {
			expect(getDefaultDimension("bedrock")).toBe(1024);
		});

		test("anthropic returns 0 (no embeddings)", () => {
			expect(getDefaultDimension("anthropic")).toBe(0);
		});

		test("unknown provider returns 768 as fallback", () => {
			expect(getDefaultDimension("unknown")).toBe(768);
		});
	});

	describe("resolveConfig embedding dimension", () => {
		test("auto-detects embeddingDimension from provider", () => {
			process.env.OPEN_MEM_EMBEDDING_DIMENSION = "";
			process.env.OPEN_MEM_PROVIDER = "";

			const config = resolveConfig("/tmp/proj", { provider: "openai", apiKey: "test-key" });

			expect(config.embeddingDimension).toBe(1536);
		});

		test("OPEN_MEM_EMBEDDING_DIMENSION env var overrides auto-detection", () => {
			process.env.OPEN_MEM_EMBEDDING_DIMENSION = "512";
			process.env.OPEN_MEM_PROVIDER = "google";

			const config = resolveConfig("/tmp/proj");

			expect(config.embeddingDimension).toBe(512);
		});
	});
});
