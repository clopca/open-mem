// =============================================================================
// open-mem — Search Orchestrator (Multi-Strategy Search)
// =============================================================================

import type { EmbeddingModel } from "ai";
import type { EntityRepository } from "../db/entities";
import type { ObservationRepository } from "../db/observations";
import type { UserObservation, UserObservationRepository } from "../db/user-memory";
import type { Observation, ObservationType, SearchResult } from "../types";
import { cosineSimilarity, generateEmbedding } from "./embeddings";
import { passesFilters } from "./filters";
import { graphAugmentedSearch } from "./graph";
import { hybridSearch } from "./hybrid";
import type { Reranker } from "./reranker";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Available search strategies for the orchestrator. */
export type SearchStrategy = "filter-only" | "semantic" | "hybrid";

/** Options for orchestrated search across project and user memory. */
export interface OrchestratedSearchOptions {
	strategy?: SearchStrategy;
	type?: ObservationType;
	file?: string;
	concept?: string;
	limit?: number;
	projectPath: string;
	importanceMin?: number;
	importanceMax?: number;
	createdAfter?: string;
	createdBefore?: string;
	concepts?: string[];
	files?: string[];
}

// -----------------------------------------------------------------------------
// SearchOrchestrator
// -----------------------------------------------------------------------------

/**
 * Coordinates multi-strategy search across FTS5, vector, graph, and user memory.
 * Supports filter-only, semantic, and hybrid search with optional LLM reranking.
 */
export class SearchOrchestrator {
	constructor(
		private observations: ObservationRepository,
		private embeddingModel: EmbeddingModel | null,
		private hasVectorExtension: boolean,
		private reranker: Reranker | null = null,
		private userObservationRepo: UserObservationRepository | null = null,
		private entityRepo: EntityRepository | null = null,
	) {}

	/** Execute a search using the configured strategy, with graph augmentation and reranking. */
	async search(query: string, options: OrchestratedSearchOptions): Promise<SearchResult[]> {
		const strategy = options.strategy ?? "hybrid";
		const limit = options.limit ?? 10;

		let results: SearchResult[];
		switch (strategy) {
			case "filter-only":
				results = this.filterOnlySearch(query, options, limit);
				break;
			case "semantic":
				results = await this.semanticSearch(query, options, limit);
				break;
			case "hybrid":
				results = await this.hybridSearchStrategy(query, options, limit);
				break;
		}

		// Label project results
		for (const r of results) {
			r.source = "project";
		}

		// Augment with graph-based entity traversal
		if (this.entityRepo && query.trim()) {
			results = await graphAugmentedSearch(
				query,
				results,
				this.entityRepo,
				this.observations,
				limit,
			);
		}

		// Merge user-level results when available
		if (this.userObservationRepo) {
			const userResults = this.searchUserMemory(query, options, limit);
			results = this.mergeResults(results, userResults, limit);
		}

		if (this.reranker && results.length > 1) {
			return this.reranker.rerank(query, results, limit);
		}

		return results;
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
				explain: {
					strategy: "filter-only",
					matchedBy: ["concept-filter"],
				},
			}));
		}

		// File-specific search
		if (options.file) {
			const observations = this.observations.searchByFile(options.file, limit, options.projectPath);
			return observations.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
				explain: {
					strategy: "filter-only",
					matchedBy: ["file-filter"],
				},
			}));
		}

		// General FTS5 search with project isolation
		return this.observations.search({
			query,
			type: options.type,
			limit,
			projectPath: options.projectPath,
			importanceMin: options.importanceMin,
			importanceMax: options.importanceMax,
			createdAfter: options.createdAfter,
			createdBefore: options.createdBefore,
			concepts: options.concepts,
			files: options.files,
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
			importanceMin: options.importanceMin,
			importanceMax: options.importanceMax,
			createdAfter: options.createdAfter,
			createdBefore: options.createdBefore,
			concepts: options.concepts,
			files: options.files,
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
				if (!passesFilters(obs, options)) continue;

				results.push({
					observation: obs,
					rank: distance - 1,
					snippet: obs.title,
					explain: {
						strategy: "semantic",
						matchedBy: ["vector"],
						vectorDistance: distance,
					},
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
			if (!passesFilters(obs, options)) continue;

			results.push({
				observation: obs,
				rank: -similarity,
				snippet: obs.title,
				explain: {
					strategy: "semantic",
					matchedBy: ["vector"],
					vectorSimilarity: similarity,
				},
			});
		}

		return results;
	}

	// ---------------------------------------------------------------------------
	// User Memory Search
	// ---------------------------------------------------------------------------

	private searchUserMemory(
		query: string,
		_options: OrchestratedSearchOptions,
		limit: number,
	): SearchResult[] {
		if (!this.userObservationRepo) return [];

		try {
			const userResults = this.userObservationRepo.search({ query, limit });
			return userResults.map(({ observation: userObs, rank }) => ({
				observation: userObservationToObservation(userObs),
				rank,
				snippet: userObs.title,
				source: "user" as const,
				explain: {
					strategy: "filter-only",
					matchedBy: ["user-memory"],
				},
			}));
		} catch {
			return [];
		}
	}

	private mergeResults(
		projectResults: SearchResult[],
		userResults: SearchResult[],
		limit: number,
	): SearchResult[] {
		const seenIds = new Set(projectResults.map((r) => r.observation.id));
		const seenContent = new Set(
			projectResults.map((r) => `${r.observation.title}::${r.observation.narrative}`),
		);
		const dedupedUserResults = userResults.filter((r) => {
			if (seenIds.has(r.observation.id)) return false;
			const contentKey = `${r.observation.title}::${r.observation.narrative}`;
			if (seenContent.has(contentKey)) return false;
			seenContent.add(contentKey);
			return true;
		});
		return [...projectResults, ...dedupedUserResults].slice(0, limit);
	}
}

function userObservationToObservation(userObs: UserObservation): Observation {
	return {
		id: userObs.id,
		sessionId: "",
		type: userObs.type,
		title: userObs.title,
		subtitle: userObs.subtitle,
		facts: userObs.facts,
		narrative: userObs.narrative,
		concepts: userObs.concepts,
		filesRead: userObs.filesRead,
		filesModified: userObs.filesModified,
		rawToolOutput: "",
		toolName: userObs.toolName,
		createdAt: userObs.createdAt,
		tokenCount: userObs.tokenCount,
		discoveryTokens: 0,
		importance: userObs.importance,
	};
}
