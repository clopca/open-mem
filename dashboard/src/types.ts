export type ObservationType =
	| "decision"
	| "bugfix"
	| "feature"
	| "refactor"
	| "discovery"
	| "change";

export interface Observation {
	id: string;
	sessionId: string;
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
	toolName: string;
	createdAt: string;
	tokenCount: number;
	discoveryTokens: number;
	revisionOf?: string | null;
	deletedAt?: string | null;
	supersededBy?: string | null;
}

export interface Session {
	id: string;
	projectPath: string;
	startedAt: string;
	endedAt: string | null;
	status: "active" | "idle" | "completed";
	observationCount: number;
	summaryId: string | null;
}

export interface SessionSummary {
	id: string;
	sessionId: string;
	summary: string;
	keyDecisions: string[];
	filesModified: string[];
	concepts: string[];
	createdAt: string;
	tokenCount: number;
}

export interface SearchResult {
	observation: Observation;
	rank: number;
	snippet: string;
	explain?: {
		strategy?: "filter-only" | "semantic" | "hybrid";
		matchedBy: Array<
			"fts" | "vector" | "graph" | "user-memory" | "concept-filter" | "file-filter"
		>;
		ftsRank?: number;
		vectorDistance?: number;
		vectorSimilarity?: number;
		rrfScore?: number;
	};
}

export interface ObservationLineageResponse {
	observationId: string;
	lineage: Observation[];
}

export interface StatsResponse {
	totalObservations: number;
	totalSessions: number;
	totalTokensSaved: number;
	averageObservationSize: number;
	typeBreakdown: Record<ObservationType, number>;
}

export interface HealthResponse {
	status: "ok" | "degraded";
	timestamp: string;
	uptimeMs: number;
	queue: {
		mode: string;
		running: boolean;
		processing: boolean;
		pending: number;
		lastBatchDurationMs: number;
		lastProcessedAt: string | null;
		lastFailedAt: string | null;
		lastError: string | null;
	};
	memory: {
		totalObservations: number;
		totalSessions: number;
	};
}

export interface MetricsResponse {
	startedAt: string;
	uptimeMs: number;
	enqueueCount: number;
	batches: {
		total: number;
		processedItems: number;
		failedItems: number;
		avgDurationMs: number;
	};
	queue: HealthResponse["queue"];
}

export interface PlatformsResponse {
	platforms: Array<{
		name: "opencode" | "claude-code" | "cursor";
		version: string;
		enabled: boolean;
		capabilities: {
			nativeSessionLifecycle: boolean;
			nativeToolCapture: boolean;
			nativeChatCapture: boolean;
			emulatedIdleFlush: boolean;
		};
	}>;
}
