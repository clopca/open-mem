import { generateText, type LanguageModel } from "ai";
import { isRetryable, sleep } from "./errors";
import { type ConflictEvaluation, parseConflictEvaluationResponse } from "./parser";
import {
	buildConflictEvaluationPrompt,
	type ConflictCandidate,
	type ConflictNewObservation,
} from "./prompts";
import { buildFallbackConfigs, createModelWithFallback } from "./provider";
import { enforceRateLimit } from "./rate-limiter";

/** Re-exported conflict evaluation types. */
export type { ConflictEvaluation, ConflictCandidate, ConflictNewObservation };
/** Re-exported conflict outcome type. */
export type { ConflictOutcome } from "./parser";

/** Configuration for the AI-powered conflict evaluator. */
export interface ConflictEvaluatorConfig {
	provider: string;
	apiKey: string | undefined;
	model: string;
	rateLimitingEnabled: boolean;
	fallbackProviders?: string[];
}

/**
 * Uses an LLM to determine whether a new observation conflicts with,
 * updates, or duplicates existing observations.
 */
export class ConflictEvaluator {
	private model: LanguageModel | null;
	private config: ConflictEvaluatorConfig;

	_generate = generateText;

	constructor(config: ConflictEvaluatorConfig) {
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
	 * Evaluate a new observation against existing candidates for conflicts.
	 * @returns Evaluation result, or null if AI is unavailable or no candidates.
	 */
	async evaluate(
		newObs: ConflictNewObservation,
		candidates: ReadonlyArray<ConflictCandidate>,
	): Promise<ConflictEvaluation | null> {
		if (!this.model || candidates.length === 0) {
			return null;
		}

		const prompt = buildConflictEvaluationPrompt(newObs, candidates);

		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (this.config.provider === "google") {
					await enforceRateLimit(this.config.model, this.config.rateLimitingEnabled);
				}
				const { text } = await this._generate({
					model: this.model,
					maxOutputTokens: 512,
					prompt,
				});

				return parseConflictEvaluationResponse(text);
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
