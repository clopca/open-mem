import type { SearchResult } from "../../types";
import { cosineSimilarity, generateEmbedding } from "../embeddings";
import { passesFilters } from "../filters";
import { executeFilterOnlyStrategy } from "./filter-only";
import type { StrategyDeps, StrategyOptions } from "./types";

export async function executeSemanticStrategy(
	deps: StrategyDeps,
	query: string,
	options: StrategyOptions,
	limit: number,
) {
	if (!deps.embeddingModel) {
		return executeFilterOnlyStrategy(deps, query, options, limit);
	}

	const queryEmbedding = await generateEmbedding(deps.embeddingModel, query);
	if (!queryEmbedding) {
		return executeFilterOnlyStrategy(deps, query, options, limit);
	}

	if (deps.hasVectorExtension) {
		try {
			const candidates = deps.observations.getVecEmbeddingMatches(queryEmbedding, limit * 3);
			if (candidates.length === 0) return [];

			const results: SearchResult[] = [];
			for (const { observationId, distance } of candidates) {
				if (results.length >= limit) break;
				const obs = deps.observations.getById(observationId);
				if (!obs) continue;
				if (!passesFilters(obs, options)) continue;
				results.push({
					observation: obs,
					rank: distance - 1,
					snippet: obs.title,
					rankingSource: "vector" as const,
					explain: {
						strategy: "semantic" as const,
						matchedBy: ["vector"],
						vectorDistance: distance,
					},
				});
			}
			return results;
		} catch {
			return executeFilterOnlyStrategy(deps, query, options, limit);
		}
	}

	const candidates = deps.observations.getWithEmbeddings(options.projectPath, limit * 10);
	if (candidates.length === 0) return [];

	const scored = candidates
		.map((candidate) => ({
			id: candidate.id,
			similarity: cosineSimilarity(queryEmbedding, candidate.embedding),
		}))
		.filter(({ similarity }) => similarity >= 0.3)
		.sort((a, b) => b.similarity - a.similarity);

	const results: SearchResult[] = [];
	for (const { id, similarity } of scored) {
		if (results.length >= limit) break;
		const obs = deps.observations.getById(id);
		if (!obs) continue;
		if (!passesFilters(obs, options)) continue;
		results.push({
			observation: obs,
			rank: -similarity,
			snippet: obs.title,
			rankingSource: "vector" as const,
			explain: {
				strategy: "semantic" as const,
				matchedBy: ["vector"],
				vectorSimilarity: similarity,
			},
		});
	}
	return results;
}
