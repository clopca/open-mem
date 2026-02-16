import { hybridSearch } from "../hybrid";
import type { StrategyDeps, StrategyOptions } from "./types";

export async function executeHybridStrategy(
	deps: StrategyDeps,
	query: string,
	options: StrategyOptions,
	limit: number,
) {
	return hybridSearch(query, deps.observations, deps.embeddingModel, {
		type: options.type,
		limit,
		projectPath: options.projectPath,
		hasVectorExtension: deps.hasVectorExtension,
		importanceMin: options.importanceMin,
		importanceMax: options.importanceMax,
		createdAfter: options.createdAfter,
		createdBefore: options.createdBefore,
		concepts: options.concepts,
		files: options.files,
	});
}
