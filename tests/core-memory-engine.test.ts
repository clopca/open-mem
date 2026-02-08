import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DefaultMemoryEngine } from "../src/core/memory-engine";
import type { RuntimeStatusSnapshot } from "../src/core/contracts";
import { ConfigAuditRepository } from "../src/db/config-audit";
import type { Database } from "../src/db/database";
import { MaintenanceHistoryRepository } from "../src/db/maintenance-history";
import { ObservationRepository } from "../src/db/observations";
import { SessionRepository } from "../src/db/sessions";
import { SummaryRepository } from "../src/db/summaries";
import { SearchOrchestrator } from "../src/search/orchestrator";
import {
	createObservationStore,
	createSessionStore,
	createSummaryStore,
} from "../src/store/sqlite/adapters";
import type { OpenMemConfig } from "../src/types";
import { cleanupTestDb, createTestDb } from "./db/helpers";

let db: Database;
let dbPath: string;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let configAuditRepo: ConfigAuditRepository;
let maintenanceHistoryRepo: MaintenanceHistoryRepository;

const TEST_PROJECT_PATH = "/tmp/test-project";

const TEST_CONFIG: OpenMemConfig = {
	dbPath: "",
	provider: "google",
	apiKey: "sk-test-secret-key-12345",
	model: "gemini-2.5-flash-lite",
	maxTokensPerCompression: 1024,
	compressionEnabled: true,
	contextInjectionEnabled: true,
	maxContextTokens: 4000,
	batchSize: 5,
	batchIntervalMs: 30_000,
	ignoredTools: [],
	minOutputLength: 50,
	maxIndexEntries: 20,
	sensitivePatterns: [],
	retentionDays: 90,
	maxDatabaseSizeMb: 500,
	logLevel: "warn",
	contextShowTokenCosts: true,
	contextObservationTypes: "all",
	contextFullObservationCount: 3,
	maxObservations: 50,
	contextShowLastSummary: true,
	rateLimitingEnabled: true,
	folderContextEnabled: true,
	folderContextMaxDepth: 5,
	dashboardEnabled: true,
	dashboardPort: 3737,
	rerankingEnabled: false,
	rerankingMaxCandidates: 20,
	entityExtractionEnabled: false,
	userMemoryEnabled: false,
	userMemoryDbPath: "/tmp/open-mem-user-memory.db",
	userMemoryMaxContextTokens: 1000,
	daemonEnabled: false,
	embeddingDimension: 1536,
	conflictResolutionEnabled: true,
	conflictSimilarityBandLow: 0.7,
	conflictSimilarityBandHigh: 0.92,
};

function createEngine(runtimeSnapshotProvider?: () => RuntimeStatusSnapshot) {
	return new DefaultMemoryEngine({
		observations: createObservationStore(observationRepo),
		sessions: createSessionStore(sessionRepo),
		summaries: createSummaryStore(new SummaryRepository(db)),
		searchOrchestrator: new SearchOrchestrator(observationRepo, null, false, null, null, null),
		projectPath: TEST_PROJECT_PATH,
		config: { ...TEST_CONFIG, dbPath },
		runtimeSnapshotProvider,
		configAuditStore: configAuditRepo,
		maintenanceHistoryStore: maintenanceHistoryRepo,
	});
}

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	observationRepo = new ObservationRepository(db);
	sessionRepo = new SessionRepository(db);
	configAuditRepo = new ConfigAuditRepository(db);
	maintenanceHistoryRepo = new MaintenanceHistoryRepository(db);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

describe("DefaultMemoryEngine contracts", () => {
	test("getLineage returns null for missing observation", () => {
		const engine = createEngine();
		expect(engine.getLineage("missing-id")).toBeNull();
	});

	test("getLineage returns lineage nodes with computed states", () => {
		sessionRepo.create("sess-lineage", TEST_PROJECT_PATH);
		const first = observationRepo.create({
			sessionId: "sess-lineage",
			type: "feature",
			title: "Initial implementation",
			subtitle: "",
			facts: [],
			narrative: "Implemented baseline behavior.",
			concepts: [],
			filesRead: [],
			filesModified: ["src/feature.ts"],
			rawToolOutput: "",
			toolName: "Edit",
			tokenCount: 20,
			discoveryTokens: 20,
		});
		const second = observationRepo.update(first.id, {
			narrative: "Implemented improved behavior.",
		});
		expect(second).not.toBeNull();
		observationRepo.delete(second!.id);

		const engine = createEngine();
		const lineage = engine.getLineage(second!.id);
		expect(lineage).not.toBeNull();
		expect(lineage?.length).toBe(2);
		expect(lineage?.[0]?.id).toBe(first.id);
		expect(lineage?.[0]?.state).toBe("superseded");
		expect(lineage?.[1]?.id).toBe(second!.id);
		expect(lineage?.[1]?.state).toBe("tombstoned");
	});

	test("getLineage stops on lineage cycles", () => {
		sessionRepo.create("sess-cycle", TEST_PROJECT_PATH);
		const first = observationRepo.create({
			sessionId: "sess-cycle",
			type: "feature",
			title: "Initial",
			subtitle: "",
			facts: [],
			narrative: "v1",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Edit",
			tokenCount: 10,
			discoveryTokens: 10,
		});
		const second = observationRepo.update(first.id, { narrative: "v2" });
		expect(second).not.toBeNull();

		observationRepo.supersede(second!.id, first.id);

		const engine = createEngine();
		const lineage = engine.getLineage(first.id);
		expect(lineage).not.toBeNull();
		expect(lineage?.length).toBe(2);
		const uniqueIds = new Set(lineage?.map((item) => item.id));
		expect(uniqueIds.size).toBe(2);
	});

	test("getRevisionDiff returns changedFields and summary", () => {
		sessionRepo.create("sess-diff", TEST_PROJECT_PATH);
		const first = observationRepo.create({
			sessionId: "sess-diff",
			type: "feature",
			title: "Original title",
			subtitle: "",
			facts: [],
			narrative: "Original narrative",
			concepts: ["a"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});
		const second = observationRepo.update(first.id, {
			title: "Updated title",
			narrative: "Updated narrative",
		});
		expect(second).not.toBeNull();

		const engine = createEngine();
		const diff = engine.getRevisionDiff(first.id, second!.id);
		expect(diff).not.toBeNull();
		expect(diff?.fromId).toBe(second!.id);
		expect(diff?.toId).toBe(first.id);
		expect(diff?.summary).toBe("Changed 2 fields: title, narrative.");
		expect(diff?.changedFields.map((item) => item.field)).toEqual(["title", "narrative"]);
	});

	test("getRevisionDiff returns no-material-changes summary for identical revisions", () => {
		sessionRepo.create("sess-diff-same", TEST_PROJECT_PATH);
		const first = observationRepo.create({
			sessionId: "sess-diff-same",
			type: "feature",
			title: "Original title",
			subtitle: "",
			facts: [],
			narrative: "Original narrative",
			concepts: ["a"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});

		const engine = createEngine();
		const diff = engine.getRevisionDiff(first.id, first.id);
		expect(diff).not.toBeNull();
		expect(diff?.summary).toBe("No material changes between revisions.");
		expect(diff?.changedFields).toEqual([]);
	});

	test("getHealth/getMetrics/getPlatforms return expected shapes without runtime provider", () => {
		sessionRepo.create("sess-metrics", TEST_PROJECT_PATH);
		observationRepo.create({
			sessionId: "sess-metrics",
			type: "discovery",
			title: "Observation",
			subtitle: "",
			facts: [],
			narrative: "n",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});

		const engine = createEngine();
		const health = engine.getHealth();
		expect(health.status).toBe("ok");
		expect(health.components).toHaveProperty("database");

		const metrics = engine.getMetrics();
		expect(metrics.memory.totalObservations).toBeGreaterThanOrEqual(1);
		expect(metrics.memory.totalSessions).toBeGreaterThanOrEqual(1);

		const platforms = engine.getPlatforms();
		expect(platforms.name).toBe("open-mem");
		expect(platforms.provider).toBe(TEST_CONFIG.provider);
		expect(platforms.dashboardEnabled).toBe(TEST_CONFIG.dashboardEnabled);
		expect(platforms.vectorEnabled).toBe(true);
	});

	test("getHealth reflects runtime snapshot provider status", () => {
		const runtimeSnapshot = () => ({
			status: "degraded" as const,
			timestamp: "2026-02-08T00:00:00.000Z",
			uptimeMs: 1000,
			queue: {
				mode: "in-process",
				running: true,
				processing: false,
				pending: 0,
				lastBatchDurationMs: 0,
				lastProcessedAt: null,
				lastFailedAt: "2026-02-08T00:00:00.000Z",
				lastError: "queue-failure",
			},
			batches: { total: 1, processedItems: 0, failedItems: 1, avgDurationMs: 0 },
			enqueueCount: 1,
		});
		const engine = createEngine(runtimeSnapshot);

		const health = engine.getHealth();
		expect(health.status).toBe("degraded");
		expect(health.timestamp).toBe("2026-02-08T00:00:00.000Z");
		expect(health.components.queue.status).toBe("degraded");
		expect(health.components.queue.detail).toBe("queue-failure");
	});

	test("config audit and maintenance history persist across engine instances", () => {
		const engineA = createEngine();
		engineA.trackConfigAudit({
			id: "audit-1",
			timestamp: "2026-02-08T10:00:00.000Z",
			patch: { batchSize: 10 },
			previousValues: { batchSize: 5 },
			source: "api",
		});
		engineA.trackMaintenanceResult({
			id: "maint-1",
			timestamp: "2026-02-08T11:00:00.000Z",
			action: "folder-context-clean",
			dryRun: false,
			result: { changed: 2 },
		});

		const engineB = createEngine();
		const audit = engineB.getConfigAuditTimeline();
		const maintenance = engineB.getMaintenanceHistory();

		expect(audit).toHaveLength(1);
		expect(audit[0]?.id).toBe("audit-1");
		expect(maintenance).toHaveLength(1);
		expect(maintenance[0]?.id).toBe("maint-1");
	});
});
