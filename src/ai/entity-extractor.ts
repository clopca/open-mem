import { type LanguageModel, generateText } from "ai";
import {
	type ParsedEntityExtraction,
	parseEntityExtractionResponse,
} from "./parser";
import {
	type EntityExtractionObservation,
	buildEntityExtractionPrompt,
} from "./prompts";
import { createModel } from "./provider";
import { enforceRateLimit } from "./rate-limiter";

export type {
	ParsedEntityExtraction as EntityExtractionResult,
	EntityExtractionObservation,
};
export type {
	ParsedEntity as ExtractedEntity,
	ParsedRelation as ExtractedRelation,
	EntityType,
	RelationshipType,
} from "./parser";

export interface EntityExtractorConfig {
	provider: string;
	apiKey: string | undefined;
	model: string;
	rateLimitingEnabled: boolean;
}

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
				this.model = createModel({
					provider: config.provider,
					model: config.model,
					apiKey: config.apiKey,
				});
			} catch {
				// Provider package not installed — fall back to no-AI mode
			}
		}
	}

	async extract(
		observation: EntityExtractionObservation,
	): Promise<ParsedEntityExtraction | null> {
		if (!this.model) {
			return null;
		}

		const prompt = buildEntityExtractionPrompt(observation);

		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (this.config.provider === "google") {
					await enforceRateLimit(
						this.config.model,
						this.config.rateLimitingEnabled,
					);
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

function isRetryable(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const err = error as Record<string, unknown>;
	const status = err.status;
	if (status === 429 || status === 500 || status === 503) return true;
	const errObj = err.error;
	if (
		typeof errObj === "object" &&
		errObj !== null &&
		(errObj as Record<string, unknown>).type === "overloaded_error"
	) {
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
