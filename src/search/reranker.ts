// =============================================================================
// open-mem — Search Result Reranker
// =============================================================================

import { type LanguageModel, generateText } from "ai";
import { parseRerankingResponse } from "../ai/parser";
import { buildRerankingPrompt } from "../ai/prompts";
import { enforceRateLimit } from "../ai/rate-limiter";
import type { SearchResult } from "../types";

// -----------------------------------------------------------------------------
// Interface
// -----------------------------------------------------------------------------

export interface Reranker {
	rerank(query: string, results: SearchResult[], limit: number): Promise<SearchResult[]>;
}

// -----------------------------------------------------------------------------
// LLM Reranker
// -----------------------------------------------------------------------------

export class LLMReranker implements Reranker {
	private languageModel: LanguageModel;
	private maxCandidates: number;
	private provider: string;
	private modelName: string;
	private rateLimitingEnabled: boolean;

	// Overridable for tests
	_generate = generateText;

	constructor(
		languageModel: LanguageModel,
		config: {
			rerankingMaxCandidates: number;
			provider?: string;
			model?: string;
			rateLimitingEnabled?: boolean;
		},
	) {
		this.languageModel = languageModel;
		this.maxCandidates = config.rerankingMaxCandidates;
		this.provider = config.provider ?? "";
		this.modelName = config.model ?? "";
		this.rateLimitingEnabled = config.rateLimitingEnabled ?? true;
	}

	async rerank(query: string, results: SearchResult[], limit: number): Promise<SearchResult[]> {
		if (results.length <= 1) return results;

		const candidates = results.slice(0, this.maxCandidates);

		const prompt = buildRerankingPrompt(
			query,
			candidates.map((r) => ({
				title: r.observation.title,
				narrative: r.observation.narrative,
			})),
		);

		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (this.provider === "google") {
					await enforceRateLimit(this.modelName, this.rateLimitingEnabled);
				}

				const { text } = await this._generate({
					model: this.languageModel,
					maxOutputTokens: 512,
					prompt,
				});

				const indices = parseRerankingResponse(text);
				if (!indices) return results.slice(0, limit);

				return this.applyReranking(candidates, indices, limit);
			} catch (error: unknown) {
				if (isRetryable(error) && attempt < maxRetries) {
					await sleep(2 ** attempt * 1000);
					continue;
				}
				// Graceful degradation: return original order
				return results.slice(0, limit);
			}
		}

		return results.slice(0, limit);
	}

	private applyReranking(
		candidates: SearchResult[],
		indices: number[],
		limit: number,
	): SearchResult[] {
		const reranked: SearchResult[] = [];
		const seen = new Set<number>();

		for (const idx of indices) {
			if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
				seen.add(idx);
				reranked.push(candidates[idx]);
				if (reranked.length >= limit) break;
			}
		}

		// Append any candidates not mentioned by the LLM (preserving original order)
		if (reranked.length < limit) {
			for (let i = 0; i < candidates.length && reranked.length < limit; i++) {
				if (!seen.has(i)) {
					reranked.push(candidates[i]);
				}
			}
		}

		return reranked;
	}
}

// -----------------------------------------------------------------------------
// Heuristic Reranker
// -----------------------------------------------------------------------------

export class HeuristicReranker implements Reranker {
	async rerank(query: string, results: SearchResult[], limit: number): Promise<SearchResult[]> {
		if (results.length <= 1) return results.slice(0, limit);

		const queryTerms = tokenize(query);

		const scored = results.map((result) => ({
			result,
			score: this.scoreCandidate(result, queryTerms),
		}));

		scored.sort((a, b) => b.score - a.score);

		return scored.slice(0, limit).map((s) => s.result);
	}

	private scoreCandidate(result: SearchResult, queryTerms: Set<string>): number {
		const obs = result.observation;

		const titleTerms = tokenize(obs.title);
		const narrativeTerms = tokenize(obs.narrative);
		const conceptTerms = new Set(obs.concepts.map((c) => c.toLowerCase()));

		let titleOverlap = 0;
		let narrativeOverlap = 0;
		let conceptOverlap = 0;

		for (const term of queryTerms) {
			if (titleTerms.has(term)) titleOverlap++;
			if (narrativeTerms.has(term)) narrativeOverlap++;
			if (conceptTerms.has(term)) conceptOverlap++;
		}

		const termCount = queryTerms.size || 1;
		const titleScore = (titleOverlap / termCount) * 0.4;
		const narrativeScore = (narrativeOverlap / termCount) * 0.3;
		const conceptScore = (conceptOverlap / termCount) * 0.15;

		// Recency boost: newer observations score higher
		const ageMs = Date.now() - new Date(obs.createdAt).getTime();
		const ageDays = ageMs / (1000 * 60 * 60 * 24);
		const recencyScore = ageDays < 1 ? 0.1 : ageDays < 7 ? 0.05 : 0;

		// Importance boost (1-5 scale normalized to 0-0.05)
		const importanceScore = (obs.importance / 5) * 0.05;

		return titleScore + narrativeScore + conceptScore + recencyScore + importanceScore;
	}
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

export function createReranker(
	config: { rerankingEnabled: boolean; rerankingMaxCandidates: number; provider?: string; model?: string; rateLimitingEnabled?: boolean },
	languageModel: LanguageModel | null,
): Reranker | null {
	if (!config.rerankingEnabled) return null;
	if (languageModel) return new LLMReranker(languageModel, config);
	return new HeuristicReranker();
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[\s\-_./\\,;:!?()[\]{}'"]+/)
			.filter((t) => t.length > 1),
	);
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
