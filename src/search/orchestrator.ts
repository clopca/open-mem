// =============================================================================
// open-mem — Search Orchestrator
// =============================================================================

import type { EmbeddingModel } from "ai";
import type { EntityRepository } from "../db/entities";
import type { ObservationRepository } from "../db/observations";
import type { UserObservation, UserObservationRepository } from "../db/user-memory";
import type {
	Observation,
	ObservationType,
	SearchExplainSignal,
	SearchLineageRef,
	SearchResult,
} from "../types";
import { graphAugmentedSearch } from "./graph";
import { InMemorySearchStrategyRegistry, type SearchStrategyRegistry } from "./registry";
import type { Reranker } from "./reranker";
import { executeFilterOnlyStrategy } from "./strategies/filter-only";
import { executeHybridStrategy } from "./strategies/hybrid";
import { executeSemanticStrategy } from "./strategies/semantic";

export type SearchStrategy = "filter-only" | "semantic" | "hybrid";

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

export class SearchOrchestrator {
	private strategyRegistry: SearchStrategyRegistry<OrchestratedSearchOptions>;

	constructor(
		private observations: ObservationRepository,
		private embeddingModel: EmbeddingModel | null,
		private hasVectorExtension: boolean,
		private reranker: Reranker | null = null,
		private userObservationRepo: UserObservationRepository | null = null,
		private entityRepo: EntityRepository | null = null,
		strategyRegistry: SearchStrategyRegistry<OrchestratedSearchOptions> | null = null,
	) {
		this.strategyRegistry =
			strategyRegistry ?? new InMemorySearchStrategyRegistry<OrchestratedSearchOptions>();

		if (!this.strategyRegistry.get("filter-only")) {
			this.strategyRegistry.register("filter-only", (options, context) =>
				executeFilterOnlyStrategy(
					{
						observations: this.observations,
						embeddingModel: this.embeddingModel,
						hasVectorExtension: this.hasVectorExtension,
					},
					context.query,
					options,
					context.limit,
				),
			);
		}

		if (!this.strategyRegistry.get("semantic")) {
			this.strategyRegistry.register("semantic", (options, context) =>
				executeSemanticStrategy(
					{
						observations: this.observations,
						embeddingModel: this.embeddingModel,
						hasVectorExtension: this.hasVectorExtension,
					},
					context.query,
					options,
					context.limit,
				),
			);
		}

		if (!this.strategyRegistry.get("hybrid")) {
			this.strategyRegistry.register("hybrid", (options, context) =>
				executeHybridStrategy(
					{
						observations: this.observations,
						embeddingModel: this.embeddingModel,
						hasVectorExtension: this.hasVectorExtension,
					},
					context.query,
					options,
					context.limit,
				),
			);
		}
	}

	async search(query: string, options: OrchestratedSearchOptions): Promise<SearchResult[]> {
		const strategy = options.strategy ?? "hybrid";
		const limit = options.limit ?? 10;

		const executor = this.strategyRegistry.get(strategy);
		if (!executor) {
			throw new Error(`Unknown search strategy: ${strategy}`);
		}

		let results = await executor(options, { query, limit });

		for (const result of results) result.source = "project";

		if (this.entityRepo && query.trim()) {
			results = await graphAugmentedSearch(
				query,
				results,
				this.entityRepo,
				this.observations,
				limit,
			);
		}

		if (this.userObservationRepo) {
			const userResults = this.searchUserMemory(query, limit);
			results = this.mergeResults(results, userResults, limit);
		}

		if (this.reranker && results.length > 1) {
			return this.reranker.rerank(query, results, limit);
		}

		return results;
	}

	private searchUserMemory(query: string, limit: number): SearchResult[] {
		if (!this.userObservationRepo) return [];
		try {
			const userResults = this.userObservationRepo.search({ query, limit });
			return userResults.map(({ observation: userObs, rank }) => ({
				observation: userObservationToObservation(userObs),
				rank,
				snippet: userObs.title,
				source: "user" as const,
				rankingSource: "user-memory" as const,
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
		const seenIds = new Set(projectResults.map((result) => result.observation.id));
		const seenContent = new Set(
			projectResults.map(
				(result) => `${result.observation.title}::${result.observation.narrative}`,
			),
		);
		const dedupedUserResults = userResults.filter((result) => {
			if (seenIds.has(result.observation.id)) return false;
			const contentKey = `${result.observation.title}::${result.observation.narrative}`;
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

export function attachExplainability(results: SearchResult[]): SearchResult[] {
	return results.map((result) => {
		const signals: SearchExplainSignal[] = [];
		if (result.explain?.matchedBy) {
			for (const source of result.explain.matchedBy) {
				if (source === "fts") {
					const rawRank = result.explain.ftsRank;
					const normalizedScore =
						rawRank !== undefined && rawRank < 0 ? 1 / (1 + Math.abs(rawRank)) : rawRank;
					signals.push({ source: "fts", score: normalizedScore, label: "Full-text search" });
				} else if (source === "vector") {
					signals.push({
						source: "vector",
						score: result.explain.vectorSimilarity ?? result.explain.vectorDistance,
						label: "Vector similarity",
					});
				} else if (source === "graph") {
					signals.push({ source: "graph", label: "Entity graph traversal" });
				} else if (source === "user-memory") {
					signals.push({ source: "user-memory", label: "User-level memory" });
				}
			}
		}

		const lineage = findLineageRef(result.observation);

		return {
			...result,
			explain: {
				...result.explain,
				strategy: result.explain?.strategy ?? "hybrid",
				matchedBy: result.explain?.matchedBy ?? [],
				signals,
				lineage,
			},
		};
	});
}

function findLineageRef(obs: Observation): SearchLineageRef | undefined {
	const info = computeLineageInfo(obs);
	if (info.rootId === obs.id) return undefined;
	return { rootId: info.rootId, depth: info.depth };
}

function computeLineageInfo(obs: Observation): { rootId: string; depth: number } {
	if (obs.revisionOf && obs.revisionOf !== obs.id) {
		return { rootId: obs.revisionOf, depth: 1 };
	}
	return { rootId: obs.id, depth: 0 };
}
