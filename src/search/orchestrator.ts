// =============================================================================
// open-mem — Search Orchestrator (Multi-Strategy Search)
// =============================================================================

import type { EmbeddingModel } from "ai";
import type { ObservationRepository } from "../db/observations";
import type { ObservationType, SearchResult } from "../types";
import { cosineSimilarity, generateEmbedding } from "./embeddings";
import { hybridSearch } from "./hybrid";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SearchStrategy = "filter-only" | "semantic" | "hybrid";

export interface OrchestratedSearchOptions {
	strategy?: SearchStrategy; // default: 'hybrid'
	type?: ObservationType;
	file?: string;
	concept?: string;
	limit?: number;
	projectPath: string;
}

// -----------------------------------------------------------------------------
// SearchOrchestrator
// -----------------------------------------------------------------------------

export class SearchOrchestrator {
	constructor(
		private observations: ObservationRepository,
		private embeddingModel: EmbeddingModel | null,
		private hasVectorExtension: boolean,
	) {}

	async search(query: string, options: OrchestratedSearchOptions): Promise<SearchResult[]> {
		const strategy = options.strategy ?? "hybrid";
		const limit = options.limit ?? 10;

		switch (strategy) {
			case "filter-only":
				return this.filterOnlySearch(query, options, limit);
			case "semantic":
				return this.semanticSearch(query, options, limit);
			case "hybrid":
				return this.hybridSearchStrategy(query, options, limit);
		}
	}

	// ---------------------------------------------------------------------------
	// Strategies
	// ---------------------------------------------------------------------------

	private filterOnlySearch(
		query: string,
		options: OrchestratedSearchOptions,
		limit: number,
	): SearchResult[] {
		// Concept-specific search
		if (options.concept) {
			const observations = this.observations.searchByConcept(
				options.concept,
				limit,
				options.projectPath,
			);
			return observations.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
			}));
		}

		// File-specific search
		if (options.file) {
			const observations = this.observations.searchByFile(options.file, limit, options.projectPath);
			return observations.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
			}));
		}

		// General FTS5 search with project isolation
		return this.observations.search({
			query,
			type: options.type,
			limit,
			projectPath: options.projectPath,
		});
	}

	private async semanticSearch(
		query: string,
		options: OrchestratedSearchOptions,
		limit: number,
	): Promise<SearchResult[]> {
		if (!this.embeddingModel) {
			// Fall back to FTS5 when no embedding model available
			return this.filterOnlySearch(query, options, limit);
		}

		const queryEmbedding = await generateEmbedding(this.embeddingModel, query);
		if (!queryEmbedding) {
			return this.filterOnlySearch(query, options, limit);
		}

		if (this.hasVectorExtension) {
			return this.nativeVectorSearch(queryEmbedding, options, limit);
		}

		return this.jsFallbackVectorSearch(queryEmbedding, options, limit);
	}

	private async hybridSearchStrategy(
		query: string,
		options: OrchestratedSearchOptions,
		limit: number,
	): Promise<SearchResult[]> {
		return hybridSearch(query, this.observations, this.embeddingModel, {
			type: options.type,
			limit,
			projectPath: options.projectPath,
			hasVectorExtension: this.hasVectorExtension,
		});
	}

	// ---------------------------------------------------------------------------
	// Vector Search Helpers
	// ---------------------------------------------------------------------------

	private nativeVectorSearch(
		queryEmbedding: number[],
		options: OrchestratedSearchOptions,
		limit: number,
	): SearchResult[] {
		try {
			const candidates = this.observations.getVecEmbeddingMatches(queryEmbedding, limit * 3);
			if (candidates.length === 0) return [];

			const results: SearchResult[] = [];
			for (const { observationId, distance } of candidates) {
				if (results.length >= limit) break;

				const obs = this.observations.getById(observationId);
				if (!obs) continue;
				if (options.type && obs.type !== options.type) continue;

				results.push({
					observation: obs,
					rank: distance - 1,
					snippet: obs.title,
				});
			}

			return results;
		} catch {
			return [];
		}
	}

	private jsFallbackVectorSearch(
		queryEmbedding: number[],
		options: OrchestratedSearchOptions,
		limit: number,
	): SearchResult[] {
		const candidates = this.observations.getWithEmbeddings(options.projectPath, limit * 10);
		if (candidates.length === 0) return [];

		const scored = candidates
			.map((c) => ({
				id: c.id,
				similarity: cosineSimilarity(queryEmbedding, c.embedding),
			}))
			.filter(({ similarity }) => similarity >= 0.3)
			.sort((a, b) => b.similarity - a.similarity);

		const results: SearchResult[] = [];
		for (const { id, similarity } of scored) {
			if (results.length >= limit) break;

			const obs = this.observations.getById(id);
			if (!obs) continue;
			if (options.type && obs.type !== options.type) continue;

			results.push({
				observation: obs,
				rank: -similarity,
				snippet: obs.title,
			});
		}

		return results;
	}
}
