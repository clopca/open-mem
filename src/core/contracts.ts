import type {
	AdapterStatus,
	ConfigAuditEvent,
	MaintenanceHistoryItem,
	Observation,
	ObservationType,
	RevisionDiff,
	SearchResult,
	Session,
	SessionSummary,
} from "../types";

export interface MemorySearchFilters {
	type?: ObservationType;
	limit?: number;
	importanceMin?: number;
	importanceMax?: number;
	after?: string;
	before?: string;
	concepts?: string[];
	files?: string[];
}

export interface MemorySaveInput {
	title: string;
	type: ObservationType;
	narrative: string;
	concepts?: string[];
	files?: string[];
	importance?: number;
	scope?: "project" | "user";
	sessionId: string;
}

export interface MemoryUpdatePatch {
	id: string;
	title?: string;
	narrative?: string;
	type?: ObservationType;
	concepts?: string[];
	importance?: number;
}

export interface MemoryExportOptions {
	type?: ObservationType;
	limit?: number;
}

export interface MemoryImportOptions {
	mode?: "skip-duplicates" | "overwrite";
}

export interface TimelineResult {
	session: Session;
	summary: SessionSummary | null;
	observations: Observation[];
}

export interface MemoryStats {
	totalObservations: number;
	totalSessions: number;
	totalTokensSaved: number;
	averageObservationSize: number;
	typeBreakdown: Record<string, number>;
}

export interface FolderContextMaintenanceResult {
	action: "clean" | "rebuild";
	dryRun: boolean;
	changed?: number;
	files?: string[];
	observations?: number;
	filesTouched?: number;
}

export interface MemoryEngine {
	ingest(input: {
		sessionId: string;
		toolName: string;
		output: string;
		callId: string;
	}): Promise<void>;
	processPending(sessionId?: string): Promise<number>;
	search(query: string, filters?: MemorySearchFilters): Promise<SearchResult[]>;
	timeline(args?: { limit?: number; sessionId?: string }): Promise<TimelineResult[]>;
	recall(ids: string[], limit?: number): Promise<Observation[]>;
	save(input: MemorySaveInput): Promise<Observation | null>;
	update(patch: MemoryUpdatePatch): Promise<Observation | null>;
	delete(ids: string[]): Promise<number>;
	export(scope: "project", options?: MemoryExportOptions): Promise<Record<string, unknown>>;
	import(
		payload: string,
		options?: MemoryImportOptions,
	): Promise<{ imported: number; skipped: number }>;
	buildContext(sessionId?: string, mode?: "normal" | "compaction"): Promise<string>;
	guide(): string;
	listObservations(input: {
		limit?: number;
		offset?: number;
		type?: ObservationType;
		sessionId?: string;
		state?: "current" | "superseded" | "tombstoned";
	}): Observation[];
	getObservation(id: string): Observation | null;
	getObservationLineage(id: string): Observation[];
	getRevisionDiff(id: string, againstId: string): RevisionDiff | null;
	getAdapterStatuses(): AdapterStatus[];
	getConfigAuditTimeline(): ConfigAuditEvent[];
	trackConfigAudit(event: ConfigAuditEvent): void;
	rollbackConfig(eventId: string): Promise<ConfigAuditEvent | null>;
	getMaintenanceHistory(): MaintenanceHistoryItem[];
	trackMaintenanceResult(item: MaintenanceHistoryItem): void;
	listSessions(input: { limit?: number; projectPath?: string }): Session[];
	getSession(id: string): TimelineResult | null;
	stats(): MemoryStats;
	maintainFolderContext(
		action: "clean" | "rebuild",
		dryRun: boolean,
	): Promise<FolderContextMaintenanceResult>;
}
