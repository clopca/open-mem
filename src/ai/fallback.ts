// =============================================================================
// open-mem — Fallback Language Model Wrapper
// =============================================================================

import type { LanguageModelV2, LanguageModelV3 } from "@ai-sdk/provider";
import { isConfigError } from "./errors";
import { DefaultProviderFallbackPolicy, type ProviderFallbackPolicy } from "./fallback-policy";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Concrete model type (excludes string model IDs from the LanguageModel union). */
type ConcreteLanguageModel = LanguageModelV2 | LanguageModelV3;

export interface FallbackProvider {
	name: string;
	model: ConcreteLanguageModel;
}

// -----------------------------------------------------------------------------
// FallbackLanguageModel
// -----------------------------------------------------------------------------

/**
 * Wraps multiple LanguageModel instances and automatically fails over to
 * backup providers when the primary returns retryable errors (429/500/503).
 *
 * Config errors (400/401/403) are thrown immediately — they indicate
 * misconfiguration, not transient failures.
 */
export class FallbackLanguageModel {
	readonly specificationVersion: string;
	readonly provider: string;
	readonly modelId: string;
	readonly supportedUrls: ConcreteLanguageModel["supportedUrls"];

	private providers: FallbackProvider[];
	private policy: ProviderFallbackPolicy;

	constructor(
		providers: FallbackProvider[],
		policy: ProviderFallbackPolicy = new DefaultProviderFallbackPolicy(),
	) {
		if (providers.length === 0) {
			throw new Error("At least one provider required");
		}

		const primary = providers[0].model;
		this.specificationVersion = primary.specificationVersion;
		this.provider = primary.provider;
		this.modelId = primary.modelId;
		this.supportedUrls = primary.supportedUrls;
		this.providers = providers;
		this.policy = policy;
	}

	// ---------------------------------------------------------------------------
	// doGenerate — non-streaming with fallback
	// ---------------------------------------------------------------------------

	async doGenerate(options: unknown): Promise<unknown> {
		let lastError: unknown;

		for (let i = 0; i < this.providers.length; i++) {
			const provider = this.providers[i];
			try {
				this.policy.onAttempt?.({
					error: null,
					provider: provider.name,
					nextProvider: this.providers[i + 1]?.name,
					attemptIndex: i,
					totalProviders: this.providers.length,
				});
				return await (provider.model.doGenerate as (opts: unknown) => Promise<unknown>)(options);
			} catch (error: unknown) {
				lastError = error;

				if (isConfigError(error)) {
					throw error;
				}

				const nextProvider = this.providers[i + 1]?.name;
				const decision = {
					error,
					provider: provider.name,
					nextProvider,
					attemptIndex: i,
					totalProviders: this.providers.length,
				};
				if (this.policy.shouldFailover(decision)) {
					this.policy.onFailover(decision);
					continue;
				}

				this.policy.onFinalFailure?.(decision);
				throw error;
			}
		}

		throw lastError;
	}

	// ---------------------------------------------------------------------------
	// doStream — streaming with fallback
	// ---------------------------------------------------------------------------

	async doStream(options: unknown): Promise<unknown> {
		let lastError: unknown;

		for (let i = 0; i < this.providers.length; i++) {
			const provider = this.providers[i];
			try {
				this.policy.onAttempt?.({
					error: null,
					provider: provider.name,
					nextProvider: this.providers[i + 1]?.name,
					attemptIndex: i,
					totalProviders: this.providers.length,
				});
				return await (provider.model.doStream as (opts: unknown) => Promise<unknown>)(options);
			} catch (error: unknown) {
				lastError = error;

				if (isConfigError(error)) {
					throw error;
				}

				const nextProvider = this.providers[i + 1]?.name;
				const decision = {
					error,
					provider: provider.name,
					nextProvider,
					attemptIndex: i,
					totalProviders: this.providers.length,
				};
				if (this.policy.shouldFailover(decision)) {
					this.policy.onFailover(decision);
					continue;
				}

				this.policy.onFinalFailure?.(decision);
				throw error;
			}
		}

		throw lastError;
	}
}
