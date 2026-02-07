// =============================================================================
// open-mem — AI Provider Factory
// =============================================================================

import type { EmbeddingModel, LanguageModel } from "ai";

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
		default:
			throw new Error(
				`Unknown provider: ${config.provider}. Supported: anthropic, bedrock, openai, google`,
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
			default:
				return null;
		}
	} catch {
		return null;
	}
}
