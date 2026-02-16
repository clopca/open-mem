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
import {
	cleanFolderContext,
	purgeFolderContext,
	rebuildFolderContext,
} from "../utils/folder-context-maintenance";
import type {
	FolderContextMaintenanceResult,
	HealthStatus,
	LineageNode,
	MemoryEngine,
	MemoryExportOptions,
	MemoryImportOptions,
	MemorySaveInput,
	MemorySearchFilters,
	MemoryStats,
	MemoryUpdatePatch,
	MetricsSnapshot,
	PlatformInfo,
	RuntimeStatusSnapshot,
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
	runtimeSnapshotProvider?: (() => RuntimeStatusSnapshot) | null;
	configAuditStore?: ConfigAuditStore | null;
	maintenanceHistoryStore?: MaintenanceHistoryStore | null;
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

interface ObservationStoreWithHistory {
	getByIdIncludingArchived?: (id: string) => Observation | null;
	listByProject?: (
		projectPath: string,
		options?: {
			limit?: number;
			offset?: number;
			type?: Observation["type"];
			state?: "current" | "superseded" | "tombstoned";
			sessionId?: string;
		},
	) => Observation[];
}

interface ConfigAuditStore {
	list(): ConfigAuditEvent[];
	getById(id: string): ConfigAuditEvent | null;
	append(event: ConfigAuditEvent): void;
}

interface MaintenanceHistoryStore {
	list(): MaintenanceHistoryItem[];
	append(item: MaintenanceHistoryItem): void;
}

export class DefaultMemoryEngine implements MemoryEngine {
	private observations: ObservationStore;
	private sessions: SessionStore;
	private summaries: SummaryStore;
	private searchOrchestrator: SearchOrchestrator;
	private projectPath: string;
	private config: OpenMemConfig;
	private userObservationRepo: UserObservationStore | null;
	private runtimeSnapshotProvider: (() => RuntimeStatusSnapshot) | null;
	private configAuditStore: ConfigAuditStore | null;
	private maintenanceHistoryStore: MaintenanceHistoryStore | null;
	private configAuditLogFallback: ConfigAuditEvent[] = [];
	private maintenanceLogFallback: MaintenanceHistoryItem[] = [];

	constructor(deps: EngineDeps) {
		this.observations = deps.observations;
		this.sessions = deps.sessions;
		this.summaries = deps.summaries;
		this.searchOrchestrator = deps.searchOrchestrator;
		this.projectPath = deps.projectPath;
		this.config = deps.config;
		this.userObservationRepo = deps.userObservationRepo ?? null;
		this.runtimeSnapshotProvider = deps.runtimeSnapshotProvider ?? null;
		this.configAuditStore = deps.configAuditStore ?? null;
		this.maintenanceHistoryStore = deps.maintenanceHistoryStore ?? null;
	}

	private getByIdIncludingArchived(id: string): Observation | null {
		const store = this.observations as ObservationStoreWithHistory;
		return store.getByIdIncludingArchived
			? store.getByIdIncludingArchived(id)
			: this.observations.getById(id);
	}

	private listByProjectWithState(input: {
		limit?: number;
		offset?: number;
		type?: Observation["type"];
		state: "current" | "superseded" | "tombstoned";
		sessionId?: string;
	}): Observation[] {
		const store = this.observations as ObservationStoreWithHistory;
		if (store.listByProject) {
			return store.listByProject(this.projectPath, input);
		}
		if (input.state !== "current") return [];
		return this.listObservations({
			limit: input.limit,
			offset: input.offset,
			type: input.type,
			sessionId: input.sessionId,
		});
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

	async timeline(
		args: {
			limit?: number;
			sessionId?: string;
			anchor?: string;
			depthBefore?: number;
			depthAfter?: number;
		} = {},
	): Promise<TimelineResult[]> {
		if (args.anchor) {
			const anchorObs = this.observations.getById(args.anchor);
			if (!anchorObs) return [];

			const depthBefore = args.depthBefore ?? 5;
			const depthAfter = args.depthAfter ?? 5;
			const surrounding = this.observations.getAroundTimestamp(
				anchorObs.createdAt,
				depthBefore,
				depthAfter,
				this.projectPath,
			);

			const allObs = [
				...surrounding.filter((o) => o.createdAt < anchorObs.createdAt),
				anchorObs,
				...surrounding.filter((o) => o.createdAt > anchorObs.createdAt),
			];

			const anchorSession = this.sessions.getById(anchorObs.sessionId);
			return [
				{
					session: anchorSession ?? {
						id: anchorObs.sessionId,
						projectPath: this.projectPath,
						startedAt: anchorObs.createdAt,
						endedAt: null,
						status: "completed" as const,
						observationCount: 0,
						summaryId: null,
					},
					summary: null,
					observations: allObs,
				},
			];
		}

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
				toolName: "mem-create",
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
			toolName: "mem-create",
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
			"# open-mem Workflow Guide",
			"",
			"## Reading Memories",
			"1. `mem-find` — Search by query (returns IDs + summaries)",
			"2. `mem-history` — Browse session timeline and summaries",
			"3. `mem-get` — Fetch full details by ID (from find/history results)",
			"",
			"## When to Save (`mem-create`)",
			"Save when the information is **stable, reusable, and non-obvious**:",
			'- Architectural decisions + rationale ("chose X over Y because...")',
			"- Non-obvious gotchas or workarounds discovered",
			"- User preferences and conventions",
			"- Cross-session plans or migration progress",
			'- Environment constraints ("Bedrock requires tool names matching [a-zA-Z0-9_-]+")',
			"",
			"## When NOT to Save",
			"Auto-capture already handles tool executions. Don't manually save:",
			"- Ephemeral logs or one-off command outputs",
			"- Information already visible in code or config files",
			"- Routine file reads or edits (auto-captured)",
			"",
			"## Memory Types",
			"- `decision` — Architectural choices with rationale",
			"- `discovery` — Non-obvious findings, gotchas, constraints",
			"- `bugfix` — Bug root causes and fixes",
			"- `feature` — Feature implementations and design notes",
			"- `refactor` — Refactoring rationale and approach",
			"- `change` — General changes worth remembering",
			"",
			"## Editing & Cleanup",
			"- `mem-revise` — Update outdated memories with new revisions",
			"- `mem-remove` — Tombstone obsolete or incorrect memories",
			"",
			"## Privacy",
			"Wrap sensitive content in `<private>` tags to exclude from memory.",
			"",
			"## Transfer",
			"- `mem-export` — Backup/portability as JSON",
			"- `mem-import` — Restore from JSON export",
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
			return this.listByProjectWithState({
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

	getLineage(id: string): LineageNode[] | null {
		const MAX_LINEAGE_HOPS = 256;
		const anchor = this.getByIdIncludingArchived(id);
		if (!anchor) return null;

		let root = anchor;
		let hops = 0;
		const reverseSeen = new Set<string>([anchor.id]);
		while (root.revisionOf && hops < MAX_LINEAGE_HOPS) {
			const previous = this.getByIdIncludingArchived(root.revisionOf);
			if (!previous || reverseSeen.has(previous.id)) break;
			root = previous;
			reverseSeen.add(previous.id);
			hops += 1;
		}

		const chain: LineageNode[] = [];
		let cursor: Observation | null = root;
		const forwardSeen = new Set<string>();
		let forwardHops = 0;
		while (cursor && !forwardSeen.has(cursor.id) && forwardHops < MAX_LINEAGE_HOPS) {
			forwardSeen.add(cursor.id);
			const state: LineageNode["state"] = cursor.deletedAt
				? "tombstoned"
				: cursor.supersededBy
					? "superseded"
					: "current";
			chain.push({
				id: cursor.id,
				revisionOf: cursor.revisionOf ?? null,
				supersededBy: cursor.supersededBy ?? null,
				supersededAt: cursor.supersededAt ?? null,
				deletedAt: cursor.deletedAt ?? null,
				state,
				observation: cursor,
			});
			cursor = cursor.supersededBy ? this.getByIdIncludingArchived(cursor.supersededBy) : null;
			forwardHops += 1;
		}

		return chain;
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
		action: "clean" | "rebuild" | "purge",
		dryRun: boolean,
	): Promise<FolderContextMaintenanceResult> {
		if (action === "purge") {
			const result = await purgeFolderContext(this.projectPath, this.config.folderContextFilename);
			return { action: "purge", dryRun: false, ...result };
		}
		if (action === "rebuild") {
			const result = await rebuildFolderContext(
				this.projectPath,
				this.sessions,
				this.observations,
				{
					maxDepth: this.config.folderContextMaxDepth,
					mode: this.config.folderContextMode,
					filename: this.config.folderContextFilename,
				},
				dryRun,
			);
			return { action, dryRun, ...result };
		}
		const result = await cleanFolderContext(
			this.projectPath,
			this.config.folderContextFilename,
			dryRun,
		);
		return { action: "clean", dryRun, ...result };
	}

	getRevisionDiff(id: string, againstId: string): RevisionDiff | null {
		const current = this.getByIdIncludingArchived(id);
		const against = this.getByIdIncludingArchived(againstId);
		if (!current || !against) return null;

		const changedFields: RevisionDiff["changedFields"] = [];
		const pushIfChanged = (
			field: RevisionDiff["changedFields"][number]["field"],
			before: unknown,
			after: unknown,
		) => {
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				changedFields.push({ field, before, after });
			}
		};

		pushIfChanged("title", against.title, current.title);
		pushIfChanged("subtitle", against.subtitle, current.subtitle);
		pushIfChanged("narrative", against.narrative, current.narrative);
		pushIfChanged("type", against.type, current.type);
		pushIfChanged("facts", against.facts, current.facts);
		pushIfChanged("concepts", against.concepts, current.concepts);
		pushIfChanged("filesRead", against.filesRead, current.filesRead);
		pushIfChanged("filesModified", against.filesModified, current.filesModified);
		pushIfChanged("importance", against.importance, current.importance);

		const summary =
			changedFields.length === 0
				? "No material changes between revisions."
				: `Changed ${changedFields.length} field${changedFields.length === 1 ? "" : "s"}: ${changedFields
						.map((f) => f.field)
						.join(", ")}.`;

		return {
			fromId: againstId,
			toId: id,
			summary,
			changedFields,
		};
	}

	getHealth(): HealthStatus {
		const runtime = this.runtimeSnapshotProvider?.();
		const queueStatus: "ok" | "degraded" = runtime?.queue.lastError ? "degraded" : "ok";

		return {
			status: runtime?.status ?? "ok",
			timestamp: runtime?.timestamp ?? new Date().toISOString(),
			components: {
				database: { status: "ok" },
				search: { status: "ok" },
				config: { status: "ok" },
				queue: {
					status: queueStatus,
					detail: runtime?.queue.lastError ?? undefined,
				},
			},
		};
	}

	getMetrics(): MetricsSnapshot {
		const stats = this.stats();
		const runtime = this.runtimeSnapshotProvider?.();
		return {
			timestamp: runtime?.timestamp ?? new Date().toISOString(),
			memory: {
				totalObservations: stats.totalObservations,
				totalSessions: stats.totalSessions,
				totalTokensSaved: stats.totalTokensSaved,
				averageObservationSize: stats.averageObservationSize,
			},
		};
	}

	getPlatforms(): PlatformInfo {
		return {
			name: "open-mem",
			provider: this.config.provider,
			dashboardEnabled: this.config.dashboardEnabled,
			vectorEnabled: Boolean(this.config.embeddingDimension && this.config.embeddingDimension > 0),
		};
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
		if (this.configAuditStore) return this.configAuditStore.list();
		return [...this.configAuditLogFallback].reverse();
	}

	trackConfigAudit(event: ConfigAuditEvent): void {
		if (this.configAuditStore) {
			this.configAuditStore.append(event);
			return;
		}
		this.configAuditLogFallback.push(event);
	}

	async rollbackConfig(eventId: string): Promise<ConfigAuditEvent | null> {
		const event = this.configAuditStore
			? this.configAuditStore.getById(eventId)
			: (this.configAuditLogFallback.find((e) => e.id === eventId) ?? null);
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
			this.trackConfigAudit(failureEvent);
			throw error;
		}

		const rollbackEvent: ConfigAuditEvent = {
			id: `rollback-${randomUUID()}`,
			timestamp: new Date().toISOString(),
			patch: event.previousValues,
			previousValues: event.patch,
			source: "rollback",
		};
		this.trackConfigAudit(rollbackEvent);
		return rollbackEvent;
	}

	getMaintenanceHistory(): MaintenanceHistoryItem[] {
		if (this.maintenanceHistoryStore) return this.maintenanceHistoryStore.list();
		return [...this.maintenanceLogFallback].reverse();
	}

	trackMaintenanceResult(item: MaintenanceHistoryItem): void {
		if (this.maintenanceHistoryStore) {
			this.maintenanceHistoryStore.append(item);
			return;
		}
		this.maintenanceLogFallback.push(item);
	}
}
