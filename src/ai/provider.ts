// =============================================================================
// open-mem — AI Provider Factory
// =============================================================================

import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import type { EmbeddingModel, LanguageModel } from "ai";
import { FallbackLanguageModel } from "./fallback";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Supported AI provider identifiers. */
export type ProviderType = "anthropic" | "bedrock" | "openai" | "google" | string;

/** Configuration for creating an AI model instance. */
export interface ModelConfig {
	provider: ProviderType;
	model: string;
	apiKey?: string;
}

// -----------------------------------------------------------------------------
// Bedrock Model Mapping
// -----------------------------------------------------------------------------

const ANTHROPIC_TO_BEDROCK_MODEL_MAP: Record<string, string> = {
	"claude-sonnet-4-20250514": "us.anthropic.claude-sonnet-4-20250514-v1:0",
	"claude-opus-4-20250514": "us.anthropic.claude-opus-4-20250514-v1:0",
	"claude-3-5-sonnet-20241022": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
	"claude-3-5-haiku-20241022": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
	"claude-3-haiku-20240307": "anthropic.claude-3-haiku-20240307-v1:0",
};

/**
 * Resolve an Anthropic model name to a Bedrock model ID.
 * If already in Bedrock format (contains "."), pass through as-is.
 */
export function resolveBedrockModel(model: string): string {
	if (model.includes(".")) return model;
	return ANTHROPIC_TO_BEDROCK_MODEL_MAP[model] || `us.anthropic.${model}-v1:0`;
}

// -----------------------------------------------------------------------------
// Provider Factory
// -----------------------------------------------------------------------------

/**
 * Create a LanguageModel instance for the given provider.
 * Uses dynamic require() so provider packages not installed don't crash at import time.
 */
export function createModel(config: ModelConfig): LanguageModel {
	switch (config.provider) {
		case "anthropic": {
			const { createAnthropic } = require("@ai-sdk/anthropic");
			const anthropic = createAnthropic({ apiKey: config.apiKey });
			return anthropic(config.model);
		}
		case "bedrock": {
			const { createAmazonBedrock } = require("@ai-sdk/amazon-bedrock");
			const bedrock = createAmazonBedrock(); // uses AWS env credentials
			return bedrock(resolveBedrockModel(config.model));
		}
		case "openai": {
			// User must install @ai-sdk/openai
			const { createOpenAI } = require("@ai-sdk/openai");
			const openai = createOpenAI({ apiKey: config.apiKey });
			return openai(config.model);
		}
		case "google": {
			// User must install @ai-sdk/google
			const { createGoogleGenerativeAI } = require("@ai-sdk/google");
			const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
			return google(config.model);
		}
		case "openrouter": {
			const { createOpenRouter } = require("@openrouter/ai-sdk-provider");
			const openrouter = createOpenRouter({ apiKey: config.apiKey });
			return openrouter(config.model);
		}
		default:
			throw new Error(
				`Unknown provider: ${config.provider}. Supported: anthropic, bedrock, openai, google, openrouter`,
			);
	}
}

/**
 * Create an EmbeddingModel instance for the given provider.
 * Returns null for providers that don't support embeddings (e.g., Anthropic).
 */
export function createEmbeddingModel(config: ModelConfig): EmbeddingModel | null {
	try {
		switch (config.provider) {
			case "google": {
				const { createGoogleGenerativeAI } = require("@ai-sdk/google");
				const google = createGoogleGenerativeAI({ apiKey: config.apiKey });
				return google.embedding("text-embedding-004");
			}
			case "openai": {
				const { createOpenAI } = require("@ai-sdk/openai");
				const openai = createOpenAI({ apiKey: config.apiKey });
				return openai.embedding("text-embedding-3-small");
			}
			case "bedrock": {
				const { createAmazonBedrock } = require("@ai-sdk/amazon-bedrock");
				const bedrock = createAmazonBedrock();
				return bedrock.embedding("amazon.titan-embed-text-v2:0");
			}
			case "anthropic":
				return null;
			case "openrouter":
				return null;
			default:
				return null;
		}
	} catch {
		return null;
	}
}

// -----------------------------------------------------------------------------
// Fallback Support
// -----------------------------------------------------------------------------

const DEFAULT_FALLBACK_MODELS: Record<string, string> = {
	google: "gemini-2.5-flash-lite",
	anthropic: "claude-sonnet-4-20250514",
	openai: "gpt-4o-mini",
	bedrock: "us.anthropic.claude-3-5-haiku-20241022-v1:0",
	openrouter: "google/gemini-2.5-flash-lite",
};

function resolveApiKeyForProvider(provider: string): string | undefined {
	switch (provider) {
		case "google":
			return process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "openai":
			return process.env.OPENAI_API_KEY;
		case "openrouter":
			return process.env.OPENROUTER_API_KEY;
		case "bedrock":
			return undefined;
		default:
			return undefined;
	}
}

export function buildFallbackConfigs(config: { fallbackProviders?: string[] }): ModelConfig[] {
	if (!config.fallbackProviders || config.fallbackProviders.length === 0) {
		return [];
	}

	return config.fallbackProviders.map((provider) => ({
		provider,
		model: DEFAULT_FALLBACK_MODELS[provider] ?? "gemini-2.5-flash-lite",
		apiKey: resolveApiKeyForProvider(provider),
	}));
}

export function createModelWithFallback(
	primaryConfig: ModelConfig,
	fallbackConfigs: ModelConfig[] = [],
): LanguageModel {
	const primary = createModel(primaryConfig);
	if (fallbackConfigs.length === 0) return primary;

	const providers = [
		{ name: primaryConfig.provider, model: primary as LanguageModelV2 | LanguageModelV3 },
		...fallbackConfigs.map((config) => ({
			name: config.provider,
			model: createModel(config) as LanguageModelV2 | LanguageModelV3,
		})),
	];
	return new FallbackLanguageModel(providers) as unknown as LanguageModel;
}
