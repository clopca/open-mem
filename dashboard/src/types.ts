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
}

export interface StatsResponse {
	totalObservations: number;
	totalSessions: number;
	totalTokensSaved: number;
	averageObservationSize: number;
	typeBreakdown: Record<ObservationType, number>;
	recentActivity: Array<{
		date: string;
		count: number;
	}>;
}
