import type {
	Observation,
	ObservationIndex,
	ObservationType,
	SearchQuery,
	SearchResult,
	Session,
	SessionSummary,
} from "../types";

export interface ObservationStore {
	create(
		data: Omit<
			Observation,
			"id" | "createdAt" | "supersededBy" | "supersededAt" | "revisionOf" | "deletedAt"
		>,
	): Observation;
	importObservation(data: Observation): void;
	getById(id: string): Observation | null;
	getByIdIncludingArchived(id: string): Observation | null;
	getLineage(id: string): Observation[];
	getBySession(sessionId: string): Observation[];
	getCount(sessionId?: string): number;
	getIndex(projectPath: string, limit?: number): ObservationIndex[];
	search(query: SearchQuery): SearchResult[];
	update(
		id: string,
		data: Partial<
			Pick<
				Observation,
				| "title"
				| "narrative"
				| "type"
				| "concepts"
				| "importance"
				| "facts"
				| "subtitle"
				| "filesRead"
				| "filesModified"
			>
		>,
	): Observation | null;
	delete(id: string): boolean;
}

export interface SessionStore {
	getById(id: string): Session | null;
	getRecent(projectPath: string, limit?: number): Session[];
	getAll(projectPath: string): Session[];
	getOrCreate(sessionId: string, projectPath: string): Session;
	incrementObservationCount(id: string): void;
	setSummary(sessionId: string, summaryId: string): void;
}

export interface SummaryStore {
	getBySessionId(sessionId: string): SessionSummary | null;
	importSummary(data: SessionSummary): void;
}

export interface UserObservationStore {
	getById(id: string):
		| (Omit<Observation, "sessionId" | "rawToolOutput" | "discoveryTokens"> & {
				sourceProject: string;
		  })
		| null;
	getIndex(limit?: number): ObservationIndex[];
	create(data: {
		type: ObservationType;
		title: string;
		subtitle: string;
		facts: string[];
		narrative: string;
		concepts: string[];
		filesRead: string[];
		filesModified: string[];
		toolName: string;
		tokenCount: number;
		importance: number;
		sourceProject: string;
	}): {
		id: string;
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
		importance: number;
		sourceProject: string;
	};
}
