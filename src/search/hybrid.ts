import type { EmbeddingModel } from "ai";
import type { ObservationRepository } from "../db/observations";
import type { ObservationType, SearchResult } from "../types";
import { cosineSimilarity, generateEmbedding } from "./embeddings";

const RRF_K = 60;

interface HybridSearchOptions {
	type?: ObservationType;
	limit?: number;
	projectPath: string;
	hasVectorExtension?: boolean;
}

export async function hybridSearch(
	query: string,
	observations: ObservationRepository,
	embeddingModel: EmbeddingModel | null,
	options: HybridSearchOptions,
): Promise<SearchResult[]> {
	const limit = options.limit ?? 10;

	const ftsResults = safelyRunFts(observations, query, options.type, limit);

	if (!embeddingModel) {
		return ftsResults;
	}

	const queryEmbedding = await generateEmbedding(embeddingModel, query);
	if (!queryEmbedding) {
		return ftsResults;
	}

	const ftsObservationIds = ftsResults.map((r) => r.observation.id);

	const vectorResults = runVectorSearch(
		observations,
		queryEmbedding,
		options.projectPath,
		options.type,
		limit,
		options.hasVectorExtension ?? false,
		ftsObservationIds,
	);

	if (vectorResults.length === 0) {
		return ftsResults;
	}

	return mergeWithRRF(ftsResults, vectorResults, limit);
}

function safelyRunFts(
	observations: ObservationRepository,
	query: string,
	type: ObservationType | undefined,
	limit: number,
): SearchResult[] {
	try {
		return observations.search({ query, type, limit });
	} catch {
		return [];
	}
}

function runVectorSearch(
	observations: ObservationRepository,
	queryEmbedding: number[],
	projectPath: string,
	type: ObservationType | undefined,
	limit: number,
	hasVectorExtension: boolean,
	ftsObservationIds: string[],
): SearchResult[] {
	if (hasVectorExtension) {
		return runNativeVectorSearch(observations, queryEmbedding, type, limit, ftsObservationIds);
	}
	return runJsFallbackVectorSearch(observations, queryEmbedding, projectPath, type, limit);
}

function runNativeVectorSearch(
	observations: ObservationRepository,
	queryEmbedding: number[],
	type: ObservationType | undefined,
	limit: number,
	ftsObservationIds: string[],
): SearchResult[] {
	try {
		let candidates: Array<{ observationId: string; distance: number }>;

		if (ftsObservationIds.length > 0) {
			candidates = observations.searchVecSubset(queryEmbedding, ftsObservationIds, limit * 3);
			if (candidates.length === 0) {
				candidates = observations.getVecEmbeddingMatches(queryEmbedding, limit * 3);
			}
		} else {
			candidates = observations.getVecEmbeddingMatches(queryEmbedding, limit * 3);
		}

		if (candidates.length === 0) return [];

		const results: SearchResult[] = [];
		for (const { observationId, distance } of candidates) {
			if (results.length >= limit) break;

			const obs = observations.getById(observationId);
			if (!obs) continue;
			if (type && obs.type !== type) continue;

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

function runJsFallbackVectorSearch(
	observations: ObservationRepository,
	queryEmbedding: number[],
	projectPath: string,
	type: ObservationType | undefined,
	limit: number,
): SearchResult[] {
	const candidates = observations.getWithEmbeddings(projectPath, limit * 10);
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

		const obs = observations.getById(id);
		if (!obs) continue;
		if (type && obs.type !== type) continue;

		results.push({
			observation: obs,
			rank: -similarity,
			snippet: obs.title,
		});
	}

	return results;
}

// Reciprocal Rank Fusion: score = Σ 1/(k + rank)
function mergeWithRRF(
	ftsResults: SearchResult[],
	vectorResults: SearchResult[],
	limit: number,
): SearchResult[] {
	const scores = new Map<string, { score: number; result: SearchResult }>();

	for (let i = 0; i < ftsResults.length; i++) {
		const r = ftsResults[i];
		const rrfScore = 1 / (RRF_K + i + 1);
		scores.set(r.observation.id, { score: rrfScore, result: r });
	}

	for (let i = 0; i < vectorResults.length; i++) {
		const r = vectorResults[i];
		const rrfScore = 1 / (RRF_K + i + 1);
		const existing = scores.get(r.observation.id);
		if (existing) {
			existing.score += rrfScore;
		} else {
			scores.set(r.observation.id, { score: rrfScore, result: r });
		}
	}

	return [...scores.values()]
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map(({ result }) => result);
}
