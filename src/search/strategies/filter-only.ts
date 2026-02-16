import type { SearchResult } from "../../types";
import type { StrategyDeps, StrategyOptions } from "./types";

function mergeUnique(values: string[]): string[] {
	return Array.from(new Set(values));
}

function mergeByObservationId(items: SearchResult[], limit: number): SearchResult[] {
	const deduped: SearchResult[] = [];
	const seen = new Set<string>();
	for (const item of items) {
		if (seen.has(item.observation.id)) continue;
		seen.add(item.observation.id);
		deduped.push(item);
		if (deduped.length >= limit) break;
	}
	return deduped;
}

function includesConcept(obsConcepts: string[], term: string): boolean {
	const target = term.toLowerCase();
	return obsConcepts.some((concept) => concept.toLowerCase() === target);
}

function includesFilePath(obsFiles: string[], term: string): boolean {
	const target = term.toLowerCase();
	return obsFiles.some((file) => file.toLowerCase().includes(target));
}

function applyAdditionalFilters(results: SearchResult[], options: StrategyOptions): SearchResult[] {
	const conceptTerms = mergeUnique([
		...(options.concept ? [options.concept] : []),
		...(options.concepts ?? []),
	]);
	const fileTerms = mergeUnique([
		...(options.file ? [options.file] : []),
		...(options.files ?? []),
	]);

	return results.filter((result) => {
		const obs = result.observation;
		if (options.type && obs.type !== options.type) return false;
		if (options.importanceMin !== undefined && obs.importance < options.importanceMin) return false;
		if (options.importanceMax !== undefined && obs.importance > options.importanceMax) return false;
		if (options.createdAfter && obs.createdAt < options.createdAfter) return false;
		if (options.createdBefore && obs.createdAt > options.createdBefore) return false;

		if (
			conceptTerms.length > 0 &&
			!conceptTerms.some((term) => includesConcept(obs.concepts, term))
		) {
			return false;
		}

		if (fileTerms.length > 0) {
			const allFiles = [...obs.filesRead, ...obs.filesModified];
			if (!fileTerms.some((term) => includesFilePath(allFiles, term))) {
				return false;
			}
		}

		return true;
	});
}

export function executeFilterOnlyStrategy(
	deps: StrategyDeps,
	query: string,
	options: StrategyOptions,
	limit: number,
): SearchResult[] {
	const conceptTerms = mergeUnique([
		...(options.concept ? [options.concept] : []),
		...(options.concepts ?? []),
	]);
	if (conceptTerms.length > 0) {
		const matches = conceptTerms.flatMap((concept) =>
			deps.observations.searchByConcept(concept, limit, options.projectPath),
		);
		const candidateResults = mergeByObservationId(
			matches.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
				rankingSource: "graph" as const,
				explain: {
					strategy: "filter-only",
					matchedBy: ["concept-filter"],
				},
			})),
			limit,
		);
		return applyAdditionalFilters(candidateResults, options).slice(0, limit);
	}

	const fileTerms = mergeUnique([
		...(options.file ? [options.file] : []),
		...(options.files ?? []),
	]);
	if (fileTerms.length > 0) {
		const matches = fileTerms.flatMap((file) =>
			deps.observations.searchByFile(file, limit, options.projectPath),
		);
		const candidateResults = mergeByObservationId(
			matches.map((obs) => ({
				observation: obs,
				rank: 0,
				snippet: obs.title,
				rankingSource: "graph" as const,
				explain: {
					strategy: "filter-only",
					matchedBy: ["file-filter"],
				},
			})),
			limit,
		);
		return applyAdditionalFilters(candidateResults, options).slice(0, limit);
	}

	return deps.observations.search({
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
