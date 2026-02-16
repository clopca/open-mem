// =============================================================================
// open-mem — Search Strategy Registry
// =============================================================================

import type { SearchResult } from "../types";

export type SearchStrategyId = "filter-only" | "semantic" | "hybrid" | (string & {});

export interface SearchStrategyContext {
	query: string;
	limit: number;
}

export type SearchStrategyExecutor<TOptions> = (
	options: TOptions,
	context: SearchStrategyContext,
) => Promise<SearchResult[]> | SearchResult[];

export interface SearchStrategyRegistry<TOptions> {
	register(strategy: SearchStrategyId, executor: SearchStrategyExecutor<TOptions>): void;
	get(strategy: SearchStrategyId): SearchStrategyExecutor<TOptions> | null;
	list(): SearchStrategyId[];
}

export class InMemorySearchStrategyRegistry<TOptions> implements SearchStrategyRegistry<TOptions> {
	private readonly strategies = new Map<SearchStrategyId, SearchStrategyExecutor<TOptions>>();

	register(strategy: SearchStrategyId, executor: SearchStrategyExecutor<TOptions>): void {
		this.strategies.set(strategy, executor);
	}

	get(strategy: SearchStrategyId): SearchStrategyExecutor<TOptions> | null {
		return this.strategies.get(strategy) ?? null;
	}

	list(): SearchStrategyId[] {
		return [...this.strategies.keys()];
	}
}
