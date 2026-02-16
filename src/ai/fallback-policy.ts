// =============================================================================
// open-mem — Provider Fallback Policy
// =============================================================================

import { isConfigError, isRetryable } from "./errors";

export interface FallbackDecisionInput {
	error: unknown | null;
	provider: string;
	nextProvider?: string;
	attemptIndex: number;
	totalProviders: number;
}

export interface ProviderFallbackPolicy {
	onAttempt?(input: FallbackDecisionInput): void;
	shouldFailover(input: FallbackDecisionInput): boolean;
	onFailover(input: FallbackDecisionInput): void;
	onFinalFailure?(input: FallbackDecisionInput): void;
}

export class DefaultProviderFallbackPolicy implements ProviderFallbackPolicy {
	shouldFailover(input: FallbackDecisionInput): boolean {
		const { error, attemptIndex, totalProviders } = input;
		if (isConfigError(error)) return false;
		if (attemptIndex >= totalProviders - 1) return false;
		return isRetryable(error);
	}

	onFailover(input: FallbackDecisionInput): void {
		const status = (input.error as Record<string, unknown>)?.status ?? "unknown";
		if (!input.nextProvider) return;
		console.error(
			`[open-mem] Provider ${input.provider} failed (${status}), falling over to ${input.nextProvider}`,
		);
	}
}
