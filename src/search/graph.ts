// =============================================================================
// open-mem — Graph-Augmented Search
// =============================================================================

import type { EntityRepository } from "../db/entities";
import type { ObservationRepository } from "../db/observations";
import type { SearchResult } from "../types";

/**
 * Augment base search results with observations discovered via entity graph traversal.
 * Finds entities mentioned in the query, traverses their relations, and appends
 * linked observations not already in the base results.
 */
export async function graphAugmentedSearch(
	query: string,
	baseResults: SearchResult[],
	entityRepo: EntityRepository,
	observationRepo: ObservationRepository,
	limit: number,
): Promise<SearchResult[]> {
	if (!query.trim()) return baseResults;

	const entityNames = extractEntityCandidates(query);
	const relatedObservationIds = new Set<string>();

	for (const name of entityNames) {
		const entities = entityRepo.findByName(name);
		for (const entity of entities) {
			const relatedIds = entityRepo.traverseRelations(entity.id, 1);
			for (const relatedId of relatedIds) {
				const obsIds = entityRepo.getObservationsForEntity(relatedId);
				for (const obsId of obsIds) {
					relatedObservationIds.add(obsId);
				}
			}
		}
	}

	if (relatedObservationIds.size === 0) return baseResults;

	const baseIds = new Set(baseResults.map((r) => r.observation.id));
	const graphResults: SearchResult[] = [];

	for (const obsId of relatedObservationIds) {
		if (baseIds.has(obsId)) continue;

		const obs = observationRepo.getById(obsId);
		if (!obs) continue;
		if (obs.supersededBy) continue;

		graphResults.push({
			observation: obs,
			rank: 0,
			snippet: obs.title,
			source: "project",
			explain: {
				strategy: "hybrid",
				matchedBy: ["graph"],
			},
		});
	}

	return [...baseResults, ...graphResults].slice(0, limit);
}

function extractEntityCandidates(query: string): string[] {
	const words = query.split(/\s+/).filter((w) => w.length >= 2);
	const candidates: string[] = [];

	for (const word of words) {
		candidates.push(word);
	}

	for (let i = 0; i < words.length - 1; i++) {
		candidates.push(`${words[i]} ${words[i + 1]}`);
	}

	return candidates;
}
