import type { EmbeddingModel } from "ai";
import type { ObservationRepository } from "../../db/observations";
import type { ObservationType } from "../../types";

export interface StrategyOptions {
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

export interface StrategyDeps {
	observations: ObservationRepository;
	embeddingModel: EmbeddingModel | null;
	hasVectorExtension: boolean;
}
