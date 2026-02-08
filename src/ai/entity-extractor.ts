import { generateText, type LanguageModel } from "ai";
import { isRetryable, sleep } from "./errors";
import { type ParsedEntityExtraction, parseEntityExtractionResponse } from "./parser";
import { buildEntityExtractionPrompt, type EntityExtractionObservation } from "./prompts";
import { buildFallbackConfigs, createModelWithFallback } from "./provider";
import { enforceRateLimit } from "./rate-limiter";

/** Re-exported entity extraction result types. */
export type { ParsedEntityExtraction as EntityExtractionResult, EntityExtractionObservation };
/** Re-exported entity and relation types. */
export type {
	EntityType,
	ParsedEntity as ExtractedEntity,
	ParsedRelation as ExtractedRelation,
	RelationshipType,
} from "./parser";

/** Configuration for the AI-powered entity extractor. */
export interface EntityExtractorConfig {
	provider: string;
	apiKey: string | undefined;
	model: string;
	rateLimitingEnabled: boolean;
	fallbackProviders?: string[];
}

/**
 * Uses an LLM to extract entities (technologies, libraries, patterns) and
 * their relationships from observation text.
 */
export class EntityExtractor {
	private model: LanguageModel | null;
	private config: EntityExtractorConfig;

	_generate = generateText;

	constructor(config: EntityExtractorConfig) {
		this.config = config;
		this.model = null;

		const providerRequiresKey = config.provider !== "bedrock";
		if (!providerRequiresKey || config.apiKey) {
			try {
				this.model = createModelWithFallback(
					{
						provider: config.provider,
						model: config.model,
						apiKey: config.apiKey,
					},
					buildFallbackConfigs(config),
				);
			} catch {
				// Provider package not installed — fall back to no-AI mode
			}
		}
	}

	/**
	 * Extract entities and relationships from an observation.
	 * @returns Extracted entities and relations, or null if AI is unavailable.
	 */
	async extract(observation: EntityExtractionObservation): Promise<ParsedEntityExtraction | null> {
		if (!this.model) {
			return null;
		}

		const prompt = buildEntityExtractionPrompt(observation);

		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (this.config.provider === "google") {
					await enforceRateLimit(this.config.model, this.config.rateLimitingEnabled);
				}
				const { text } = await this._generate({
					model: this.model,
					maxOutputTokens: 1024,
					prompt,
				});

				return parseEntityExtractionResponse(text);
			} catch (error: unknown) {
				if (isRetryable(error) && attempt < maxRetries) {
					const delay = 2 ** attempt * 1000;
					await sleep(delay);
					continue;
				}
				return null;
			}
		}

		return null;
	}
}
