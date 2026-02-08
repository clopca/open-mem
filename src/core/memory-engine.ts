import { randomUUID } from "node:crypto";
import { estimateTokens } from "../ai/parser";
import {
	buildCompactContext,
	buildContextString,
	buildUserCompactContext,
	buildUserContextSection,
	type ContextBuilderConfig,
} from "../context/builder";
import { buildProgressiveContext } from "../context/progressive";
import type { SearchOrchestrator } from "../search/orchestrator";
import type {
	ObservationStore,
	SessionStore,
	SummaryStore,
	UserObservationStore,
} from "../store/ports";
import type {
	AdapterStatus,
	ConfigAuditEvent,
	MaintenanceHistoryItem,
	Observation,
	OpenMemConfig,
	RevisionDiff,
	SearchResult,
} from "../types";
import { cleanFolderContext, rebuildFolderContext } from "../utils/folder-context-maintenance";
import type {
	FolderContextMaintenanceResult,
	MemoryEngine,
	MemoryExportOptions,
	MemoryImportOptions,
	MemorySaveInput,
	MemorySearchFilters,
	MemoryStats,
	MemoryUpdatePatch,
	TimelineResult,
} from "./contracts";

interface EngineDeps {
	observations: ObservationStore;
	sessions: SessionStore;
	summaries: SummaryStore;
	searchOrchestrator: SearchOrchestrator;
	projectPath: string;
	config: OpenMemConfig;
	userObservationRepo?: UserObservationStore | null;
}

interface ExportData {
	version: number;
	exportedAt: string;
	project: string;
	observations: Array<Omit<Observation, "rawToolOutput"> & { rawToolOutput?: string }>;
	summaries: Array<{
		id: string;
		sessionId: string;
		summary: string;
		keyDecisions: string[];
		filesModified: string[];
		concepts: string[];
		createdAt: string;
		tokenCount: number;
		request?: string;
		investigated?: string;
		learned?: string;
		completed?: string;
		nextSteps?: string;
	}>;
}

export class DefaultMemoryEngine implements MemoryEngine {
	private observations: ObservationStore;
	private sessions: SessionStore;
	private summaries: SummaryStore;
	private searchOrchestrator: SearchOrchestrator;
	private projectPath: string;
	private config: OpenMemConfig;
	private userObservationRepo: UserObservationStore | null;
	/** In-memory only — lost on process restart. Persistence is a known future enhancement. */
	private configAuditLog: ConfigAuditEvent[] = [];
	/** In-memory only — lost on process restart. Persistence is a known future enhancement. */
	private maintenanceLog: MaintenanceHistoryItem[] = [];

	constructor(deps: EngineDeps) {
		this.observations = deps.observations;
		this.sessions = deps.sessions;
		this.summaries = deps.summaries;
		this.searchOrchestrator = deps.searchOrchestrator;
		this.projectPath = deps.projectPath;
		this.config = deps.config;
		this.userObservationRepo = deps.userObservationRepo ?? null;
	}

	async ingest(_input: {
		sessionId: string;
		toolName: string;
		output: string;
		callId: string;
	}): Promise<void> {
		// Capture/queue ingestion remains owned by hook+queue pipeline.
	}

	async processPending(_sessionId?: string): Promise<number> {
		// Queue processing remains owned by runtime queue processor.
		return 0;
	}

	async search(query: string, filters: MemorySearchFilters = {}): Promise<SearchResult[]> {
		return this.searchOrchestrator.search(query, {
			type: filters.type,
			limit: filters.limit ?? 10,
			projectPath: this.projectPath,
			importanceMin: filters.importanceMin,
			importanceMax: filters.importanceMax,
			createdAfter: filters.after,
			createdBefore: filters.before,
			concepts: filters.concepts,
			files: filters.files,
		});
	}

	async timeline(args: { limit?: number; sessionId?: string } = {}): Promise<TimelineResult[]> {
		if (args.sessionId) {
			const session = this.sessions.getById(args.sessionId);
			if (!session) return [];
			return [
				{
					session,
					summary: this.summaries.getBySessionId(session.id),
					observations: this.observations.getBySession(session.id),
				},
			];
		}

		const recent = this.sessions.getRecent(this.projectPath, args.limit ?? 5);
		return recent.map((session) => ({
			session,
			summary: this.summaries.getBySessionId(session.id),
			observations: [],
		}));
	}

	async recall(ids: string[], limit = 10): Promise<Observation[]> {
		const out: Observation[] = [];
		for (const id of ids.slice(0, limit)) {
			const projectObs = this.observations.getById(id);
			if (projectObs) {
				out.push(projectObs);
				continue;
			}
			if (!this.userObservationRepo) continue;
			const userObs = this.userObservationRepo.getById(id);
			if (!userObs) continue;
			out.push({
				...userObs,
				sessionId: "",
				rawToolOutput: "",
				discoveryTokens: 0,
			});
		}
		return out;
	}

	async save(input: MemorySaveInput): Promise<Observation | null> {
		if (input.scope === "user") {
			if (!this.userObservationRepo) return null;
			const userObs = this.userObservationRepo.create({
				type: input.type,
				title: input.title,
				subtitle: "",
				facts: [],
				narrative: input.narrative,
				concepts: input.concepts ?? [],
				filesRead: [],
				filesModified: input.files ?? [],
				toolName: "memory.create",
				tokenCount: estimateTokens(`${input.title} ${input.narrative}`),
				importance: input.importance ?? 3,
				sourceProject: this.projectPath,
			});
			return {
				...userObs,
				sessionId: "",
				rawToolOutput: "",
				discoveryTokens: 0,
			};
		}

		this.sessions.getOrCreate(input.sessionId, this.projectPath);
		const observation = this.observations.create({
			sessionId: input.sessionId,
			type: input.type,
			title: input.title,
			subtitle: "",
			facts: [],
			narrative: input.narrative,
			concepts: input.concepts ?? [],
			filesRead: [],
			filesModified: input.files ?? [],
			rawToolOutput: `[Manual save] ${input.narrative}`,
			toolName: "memory.create",
			tokenCount: estimateTokens(`${input.title} ${input.narrative}`),
			discoveryTokens: 0,
			importance: input.importance ?? 3,
		});
		this.sessions.incrementObservationCount(input.sessionId);
		return observation;
	}

	async update(patch: MemoryUpdatePatch): Promise<Observation | null> {
		const existing = this.observations.getById(patch.id);
		if (!existing) return null;
		const session = this.sessions.getById(existing.sessionId);
		if (!session || session.projectPath !== this.projectPath) return null;
		const { id: _id, ...data } = patch;
		return this.observations.update(patch.id, data) ?? null;
	}

	async delete(ids: string[]): Promise<number> {
		let deleted = 0;
		for (const id of ids) {
			const existing = this.observations.getById(id);
			if (!existing) continue;
			const session = this.sessions.getById(existing.sessionId);
			if (!session || session.projectPath !== this.projectPath) continue;
			if (this.observations.delete(id)) deleted += 1;
		}
		return deleted;
	}

	async export(
		scope: "project",
		options: MemoryExportOptions = {},
	): Promise<Record<string, unknown>> {
		if (scope !== "project") {
			throw new Error("Only project scope export is supported.");
		}

		const projectSessions = this.sessions.getAll(this.projectPath);
		let allObservations: Observation[] = [];
		for (const session of projectSessions) {
			allObservations.push(...this.observations.getBySession(session.id));
		}

		if (options.type) {
			allObservations = allObservations.filter((obs) => obs.type === options.type);
		}
		allObservations.sort(
			(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
		);
		if (options.limit && options.limit < allObservations.length) {
			allObservations = allObservations.slice(0, options.limit);
		}

		const exportedObservations = allObservations.map(({ rawToolOutput: _raw, ...rest }) => rest);
		const allSummaries = projectSessions
			.map((session) => this.summaries.getBySessionId(session.id))
			.filter((summary): summary is NonNullable<typeof summary> => summary !== null);

		const exportData: ExportData = {
			version: 1,
			exportedAt: new Date().toISOString(),
			project: this.projectPath,
			observations: exportedObservations,
			summaries: allSummaries,
		};
		return exportData as unknown as Record<string, unknown>;
	}

	async import(
		payload: string,
		options: MemoryImportOptions = {},
	): Promise<{ imported: number; skipped: number }> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(payload);
		} catch {
			throw new Error("Invalid JSON payload.");
		}
		if (typeof parsed !== "object" || parsed === null) {
			throw new Error("Invalid import payload.");
		}

		const data = parsed as ExportData;
		if (data.version !== 1 || !Array.isArray(data.observations)) {
			throw new Error("Unsupported export format.");
		}

		const mode = options.mode ?? "skip-duplicates";
		let imported = 0;
		let skipped = 0;

		for (const obs of data.observations) {
			const existing = this.observations.getById(obs.id);
			if (existing && mode === "skip-duplicates") {
				skipped += 1;
				continue;
			}
			if (existing && mode === "overwrite") {
				this.observations.delete(obs.id);
			}

			this.sessions.getOrCreate(obs.sessionId, this.projectPath);
			this.observations.importObservation({
				id: obs.id,
				sessionId: obs.sessionId,
				type: obs.type,
				title: obs.title,
				subtitle: obs.subtitle ?? "",
				facts: obs.facts ?? [],
				narrative: obs.narrative ?? "",
				concepts: obs.concepts ?? [],
				filesRead: obs.filesRead ?? [],
				filesModified: obs.filesModified ?? [],
				rawToolOutput: obs.rawToolOutput ?? "",
				toolName: obs.toolName ?? "unknown",
				createdAt: obs.createdAt,
				tokenCount: obs.tokenCount ?? 0,
				discoveryTokens: obs.discoveryTokens ?? 0,
				importance: obs.importance ?? 3,
				supersededBy: obs.supersededBy ?? null,
				supersededAt: obs.supersededAt ?? null,
			});
			this.sessions.incrementObservationCount(obs.sessionId);
			imported += 1;
		}

		for (const summary of data.summaries ?? []) {
			const existing = this.summaries.getBySessionId(summary.sessionId);
			if (existing && mode === "skip-duplicates") {
				continue;
			}
			if (existing && mode === "overwrite") {
				continue;
			}
			this.sessions.getOrCreate(summary.sessionId, this.projectPath);
			this.summaries.importSummary(summary);
			this.sessions.setSummary(summary.sessionId, summary.id);
		}

		return { imported, skipped };
	}

	async buildContext(
		_sessionId?: string,
		mode: "normal" | "compaction" = "normal",
	): Promise<string> {
		const recentSessions = this.sessions.getRecent(this.projectPath, 5);
		const recentSummaries = recentSessions
			.map((s) => (s.summaryId ? this.summaries.getBySessionId(s.id) : null))
			.filter((s): s is NonNullable<typeof s> => s !== null);
		const observationIndex = this.observations.getIndex(
			this.projectPath,
			this.config.maxObservations,
		);

		const recentObsIds = observationIndex
			.slice(0, this.config.contextFullObservationCount)
			.map((e) => e.id);
		const fullObservations: Observation[] = recentObsIds
			.map((id) => this.observations.getById(id))
			.filter((o): o is NonNullable<typeof o> => o !== null);

		const progressive = buildProgressiveContext(
			recentSessions,
			recentSummaries,
			observationIndex,
			this.config.maxContextTokens,
			fullObservations,
		);

		if (mode === "compaction") {
			let out = buildCompactContext(progressive);
			if (this.config.userMemoryEnabled && this.userObservationRepo) {
				out += buildUserCompactContext(
					this.userObservationRepo.getIndex(this.config.maxObservations),
					this.config.userMemoryMaxContextTokens,
				);
			}
			return out;
		}

		const builderConfig: ContextBuilderConfig = {
			showTokenCosts: this.config.contextShowTokenCosts,
			observationTypes: this.config.contextObservationTypes,
			fullObservationCount: this.config.contextFullObservationCount,
			showLastSummary: this.config.contextShowLastSummary,
		};
		let out = buildContextString(progressive, builderConfig);
		if (this.config.userMemoryEnabled && this.userObservationRepo) {
			const userSection = buildUserContextSection(
				this.userObservationRepo.getIndex(this.config.maxObservations),
				this.config.userMemoryMaxContextTokens,
			);
			if (userSection) out += `\n\n${userSection}`;
		}
		return out;
	}

	guide(): string {
		return [
			"open-mem workflow:",
			"1) Use memory.find to find candidate observations by query.",
			"2) Use memory.history to inspect session-level history and summaries.",
			"3) Use memory.get with IDs from find/history to fetch full details.",
			"Write/edit flow: memory.create (new), memory.revise (refine), memory.remove (tombstone).",
			"Transfer flow: memory.transfer.export for backup/portability, memory.transfer.import to restore.",
		].join("\n");
	}

	listObservations(input: {
		limit?: number;
		offset?: number;
		type?: Observation["type"];
		sessionId?: string;
		state?: "current" | "superseded" | "tombstoned";
	}): Observation[] {
		const { limit = 50, offset = 0, type, sessionId, state } = input;

		if (state) {
			return this.observations.listByProject(this.projectPath, {
				limit,
				offset,
				type,
				state,
				sessionId,
			});
		}

		if (sessionId) {
			let observations = this.observations.getBySession(sessionId);
			if (type) observations = observations.filter((o) => o.type === type);
			return observations.slice(offset, offset + limit);
		}

		const index = this.observations.getIndex(this.projectPath, offset + limit);
		let items = index.slice(offset);
		if (type) items = items.filter((o) => o.type === type);
		return items
			.map((item) => this.observations.getById(item.id))
			.filter((o): o is NonNullable<typeof o> => o !== null);
	}

	getObservation(id: string): Observation | null {
		return this.observations.getById(id);
	}

	getObservationLineage(id: string): Observation[] {
		return this.observations.getLineage(id);
	}

	listSessions(input: { limit?: number; projectPath?: string }): Array<{
		id: string;
		projectPath: string;
		startedAt: string;
		endedAt: string | null;
		status: "active" | "idle" | "completed";
		observationCount: number;
		summaryId: string | null;
	}> {
		return this.sessions.getRecent(input.projectPath ?? this.projectPath, input.limit ?? 20);
	}

	getSession(id: string): TimelineResult | null {
		const session = this.sessions.getById(id);
		if (!session) return null;
		return {
			session,
			summary: this.summaries.getBySessionId(id),
			observations: this.observations.getBySession(id),
		};
	}

	stats(): MemoryStats {
		const totalObservations = this.observations.getCount();
		const sessions = this.sessions.getAll(this.projectPath);
		const totalSessions = sessions.length;
		const index = this.observations.getIndex(this.projectPath, 10000);

		let totalTokenCount = 0;
		let totalDiscoveryTokens = 0;
		const typeBreakdown: Record<string, number> = {};
		for (const entry of index) {
			totalTokenCount += entry.tokenCount;
			totalDiscoveryTokens += entry.discoveryTokens;
			typeBreakdown[entry.type] = (typeBreakdown[entry.type] || 0) + 1;
		}
		const tokensSaved = totalDiscoveryTokens - totalTokenCount;
		const avgObservationSize = index.length > 0 ? Math.round(totalTokenCount / index.length) : 0;
		return {
			totalObservations,
			totalSessions,
			totalTokensSaved: tokensSaved,
			averageObservationSize: avgObservationSize,
			typeBreakdown,
		};
	}

	async maintainFolderContext(
		action: "clean" | "rebuild",
		dryRun: boolean,
	): Promise<FolderContextMaintenanceResult> {
		if (action === "rebuild") {
			const result = await rebuildFolderContext(
				this.projectPath,
				this.sessions,
				this.observations,
				this.config.folderContextMaxDepth,
				dryRun,
			);
			return { action, dryRun, ...result };
		}
		const result = await cleanFolderContext(this.projectPath, dryRun);
		return { action: "clean", dryRun, ...result };
	}

	getRevisionDiff(id: string, againstId: string): RevisionDiff | null {
		const base = this.observations.getByIdIncludingArchived(id);
		const against = this.observations.getByIdIncludingArchived(againstId);
		if (!base || !against) return null;

		const DIFF_FIELDS: Array<{ key: keyof Observation; label: string }> = [
			{ key: "title", label: "title" },
			{ key: "narrative", label: "narrative" },
			{ key: "type", label: "type" },
			{ key: "importance", label: "importance" },
			{ key: "subtitle", label: "subtitle" },
		];
		const ARRAY_DIFF_FIELDS: Array<{ key: keyof Observation; label: string }> = [
			{ key: "concepts", label: "concepts" },
			{ key: "facts", label: "facts" },
			{ key: "filesRead", label: "filesRead" },
			{ key: "filesModified", label: "filesModified" },
		];

		const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

		for (const { key, label } of DIFF_FIELDS) {
			if (base[key] !== against[key]) {
				changes.push({ field: label, before: base[key], after: against[key] });
			}
		}
		for (const { key, label } of ARRAY_DIFF_FIELDS) {
			const a = JSON.stringify(base[key]);
			const b = JSON.stringify(against[key]);
			if (a !== b) {
				changes.push({ field: label, before: base[key], after: against[key] });
			}
		}

		return { baseId: id, againstId, changes };
	}

	getAdapterStatuses(): AdapterStatus[] {
		const enabled: Record<string, boolean> = {
			opencode: this.config.platformOpenCodeEnabled ?? true,
			"claude-code": this.config.platformClaudeCodeEnabled ?? false,
			cursor: this.config.platformCursorEnabled ?? false,
		};
		const adapters = [
			{
				name: "opencode",
				version: "1.0",
				capabilities: {
					nativeSessionLifecycle: true,
					nativeToolCapture: true,
					nativeChatCapture: true,
					emulatedIdleFlush: false,
				},
			},
			{
				name: "claude-code",
				version: "0.1",
				capabilities: {
					nativeSessionLifecycle: true,
					nativeToolCapture: true,
					nativeChatCapture: true,
					emulatedIdleFlush: true,
				},
			},
			{
				name: "cursor",
				version: "0.1",
				capabilities: {
					nativeSessionLifecycle: false,
					nativeToolCapture: true,
					nativeChatCapture: true,
					emulatedIdleFlush: true,
				},
			},
		];
		return adapters.map((adapter) => ({
			name: adapter.name,
			version: adapter.version,
			enabled: enabled[adapter.name] ?? false,
			capabilities: adapter.capabilities as Record<string, boolean>,
		}));
	}

	getConfigAuditTimeline(): ConfigAuditEvent[] {
		return [...this.configAuditLog].reverse();
	}

	trackConfigAudit(event: ConfigAuditEvent): void {
		this.configAuditLog.push(event);
	}

	async rollbackConfig(eventId: string): Promise<ConfigAuditEvent | null> {
		const event = this.configAuditLog.find((e) => e.id === eventId);
		if (!event) return null;

		if (!event.previousValues || typeof event.previousValues !== "object") {
			return null;
		}

		const { patchConfig: doPatch } = await import("../config/store");
		const rollbackPatch = event.previousValues as Partial<import("../types").OpenMemConfig>;

		try {
			await doPatch(this.projectPath, rollbackPatch);
		} catch (error) {
			const failureEvent: ConfigAuditEvent = {
				id: `rollback-failed-${randomUUID()}`,
				timestamp: new Date().toISOString(),
				patch: event.previousValues,
				previousValues: event.patch,
				source: "rollback-failed",
			};
			this.configAuditLog.push(failureEvent);
			throw error;
		}

		const rollbackEvent: ConfigAuditEvent = {
			id: `rollback-${randomUUID()}`,
			timestamp: new Date().toISOString(),
			patch: event.previousValues,
			previousValues: event.patch,
			source: "rollback",
		};
		this.configAuditLog.push(rollbackEvent);
		return rollbackEvent;
	}

	getMaintenanceHistory(): MaintenanceHistoryItem[] {
		return [...this.maintenanceLog].reverse();
	}

	trackMaintenanceResult(item: MaintenanceHistoryItem): void {
		this.maintenanceLog.push(item);
	}
}
