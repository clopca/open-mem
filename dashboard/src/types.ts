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
	scope?: "project" | "user";
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
	rawToolOutput?: string;
	toolName: string;
	createdAt: string;
	tokenCount: number;
	discoveryTokens: number;
	importance?: number;
	revisionOf?: string | null;
	deletedAt?: string | null;
	supersededBy?: string | null;
	supersededAt?: string | null;
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

export type RankingSignalSource = "fts" | "vector" | "graph" | "user-memory";

export type SignalSource =
	| "fts"
	| "vector"
	| "graph"
	| "user-memory"
	| "concept-filter"
	| "file-filter";

export interface SearchExplainSignal {
	source: RankingSignalSource;
	score?: number;
	label?: string;
}

export interface SearchLineageRef {
	rootId: string;
	depth: number;
}

export interface SearchResult {
	observation: Observation;
	rank: number;
	snippet: string;
	source?: "project" | "user";
	rankingSource?: RankingSignalSource;
	explain?: {
		strategy?: "filter-only" | "semantic" | "hybrid";
		matchedBy: Array<"fts" | "vector" | "graph" | "user-memory" | "concept-filter" | "file-filter">;
		ftsRank?: number;
		vectorDistance?: number;
		vectorSimilarity?: number;
		rrfScore?: number;
		signals?: SearchExplainSignal[];
		lineage?: SearchLineageRef;
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

export interface AdapterStatus {
	name: string;
	version: string;
	enabled: boolean;
	connected?: boolean;
	eventsIngested?: number;
	errors?: number;
	capabilities: Record<string, boolean>;
}

export interface ConfigAuditEvent {
	id: string;
	timestamp: string;
	patch: Record<string, unknown>;
	previousValues: Record<string, unknown>;
	source: "api" | "mode" | "rollback";
}

export interface MaintenanceHistoryItem {
	id: string;
	timestamp: string;
	action: string;
	dryRun: boolean;
	result: Record<string, unknown>;
}
