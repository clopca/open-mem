// =============================================================================
// open-mem — AI Session Summarizer
// =============================================================================

import { type LanguageModel, generateText } from "ai";
import type { Observation } from "../types";
import { type ParsedSummary, parseSummaryResponse } from "./parser";
import { buildSummarizationPrompt } from "./prompts";
import { createModel } from "./provider";
import { enforceRateLimit } from "./rate-limiter";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Configuration for the AI session summarizer. */
export interface SummarizerConfig {
	provider: string;
	apiKey: string | undefined;
	model: string;
	maxTokensPerCompression: number;
	compressionEnabled: boolean;
	rateLimitingEnabled: boolean;
}

// -----------------------------------------------------------------------------
// SessionSummarizer
// -----------------------------------------------------------------------------

/**
 * Generates a concise summary of a coding session from its observations.
 * Falls back to a heuristic aggregation when the API is unavailable.
 */
export class SessionSummarizer {
	private model: LanguageModel | null;
	private config: SummarizerConfig;

	// Overridable for tests
	_generate = generateText;

	constructor(config: SummarizerConfig) {
		this.config = config;
		this.model = null;

		const providerRequiresKey = config.provider !== "bedrock";
		if (config.compressionEnabled && (!providerRequiresKey || config.apiKey)) {
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

	// ---------------------------------------------------------------------------
	// Summarization
	// ---------------------------------------------------------------------------

	/**
	 * Summarize a session's observations via the AI provider.
	 * Returns `null` for empty observation lists, falls back to heuristic
	 * summary when the API is disabled or errors out.
	 */
	async summarize(
		sessionId: string,
		observations: ReadonlyArray<Observation>,
	): Promise<ParsedSummary | null> {
		if (observations.length === 0) return null;

		if (!this.config.compressionEnabled || !this.model) {
			return this.createFallbackSummary(observations);
		}

		const prompt = buildSummarizationPrompt(
			observations.map((o) => ({
				type: o.type,
				title: o.title,
				narrative: o.narrative,
			})),
			sessionId,
		);

		try {
			if (this.config.provider === "google") {
				await enforceRateLimit(this.config.model, this.config.rateLimitingEnabled);
			}
			const { text } = await this._generate({
				model: this.model,
				maxOutputTokens: this.config.maxTokensPerCompression,
				prompt,
			});

			const parsed = parseSummaryResponse(text);
			if (!parsed) {
				return this.createFallbackSummary(observations);
			}

			return parsed;
		} catch {
			return this.createFallbackSummary(observations);
		}
	}

	// ---------------------------------------------------------------------------
	// Fallback (no API needed)
	// ---------------------------------------------------------------------------

	/**
	 * Build a summary by aggregating observation metadata — no AI required.
	 */
	createFallbackSummary(observations: ReadonlyArray<Observation>): ParsedSummary {
		const allFiles = new Set<string>();
		const allConcepts = new Set<string>();
		const decisions: string[] = [];

		for (const obs of observations) {
			for (const f of obs.filesModified) allFiles.add(f);
			for (const c of obs.concepts) allConcepts.add(c);
			if (obs.type === "decision") {
				decisions.push(obs.title);
			}
		}

		// Count observations by type
		const typeGroups = new Map<string, number>();
		for (const obs of observations) {
			typeGroups.set(obs.type, (typeGroups.get(obs.type) ?? 0) + 1);
		}

		const typeSummary = Array.from(typeGroups.entries())
			.map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
			.join(", ");

		const conceptsList = Array.from(allConcepts).slice(0, 5).join(", ");

		return {
			summary: `Session with ${observations.length} observations: ${typeSummary}. Files modified: ${allFiles.size}. Key concepts: ${conceptsList}.`,
			keyDecisions: decisions.slice(0, 5),
			filesModified: Array.from(allFiles),
			concepts: Array.from(allConcepts),
		};
	}

	// ---------------------------------------------------------------------------
	// Utility
	// ---------------------------------------------------------------------------

	/** Whether a session has enough observations to warrant summarization */
	shouldSummarize(observationCount: number): boolean {
		return observationCount >= 2;
	}
}
