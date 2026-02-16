import type { SearchResult } from "../../types";
import type { StrategyDeps, StrategyOptions } from "./types";

export function executeFilterOnlyStrategy(
	deps: StrategyDeps,
	query: string,
	options: StrategyOptions,
	limit: number,
): SearchResult[] {
	if (options.concept) {
		const observations = deps.observations.searchByConcept(
			options.concept,
			limit,
			options.projectPath,
		);
		return observations.map((obs) => ({
			observation: obs,
			rank: 0,
			snippet: obs.title,
			rankingSource: "graph" as const,
			explain: {
				strategy: "filter-only",
				matchedBy: ["concept-filter"],
			},
		}));
	}

	if (options.file) {
		const observations = deps.observations.searchByFile(options.file, limit, options.projectPath);
		return observations.map((obs) => ({
			observation: obs,
			rank: 0,
			snippet: obs.title,
			rankingSource: "graph" as const,
			explain: {
				strategy: "filter-only",
				matchedBy: ["file-filter"],
			},
		}));
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
