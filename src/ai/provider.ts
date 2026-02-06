// =============================================================================
// open-mem — AI Provider Factory
// =============================================================================

import type { LanguageModel } from "ai";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type ProviderType = "anthropic" | "bedrock" | "openai" | "google" | string;

export interface ModelConfig {
	provider: ProviderType;
	model: string;
	apiKey?: string;
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
			return bedrock(config.model);
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
