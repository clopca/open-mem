import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { Hono } from "hono";
import { createDashboardApp, type DashboardDeps } from "../../src/adapters/http/server";
import { DefaultMemoryEngine } from "../../src/core/memory-engine";
import { ConfigAuditRepository } from "../../src/db/config-audit";
import type { Database } from "../../src/db/database";
import { MaintenanceHistoryRepository } from "../../src/db/maintenance-history";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import {
	createObservationStore,
	createSessionStore,
	createSummaryStore,
} from "../../src/store/sqlite/adapters";
import type { OpenMemConfig } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let app: Hono;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;
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
};

function parseEnvelope<T>(json: unknown): {
	data: T;
	error: unknown;
	meta: Record<string, unknown>;
} {
	return json as { data: T; error: unknown; meta: Record<string, unknown> };
}

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;

	observationRepo = new ObservationRepository(db);
	sessionRepo = new SessionRepository(db);
	summaryRepo = new SummaryRepository(db);
	configAuditRepo = new ConfigAuditRepository(db);
	maintenanceHistoryRepo = new MaintenanceHistoryRepository(db);

	const memoryEngine = new DefaultMemoryEngine({
		observations: createObservationStore(observationRepo),
		sessions: createSessionStore(sessionRepo),
		summaries: createSummaryStore(summaryRepo),
		searchOrchestrator: new SearchOrchestrator(observationRepo, null, false, null, null, null),
		projectPath: TEST_PROJECT_PATH,
		config: { ...TEST_CONFIG, dbPath },
		configAuditStore: configAuditRepo,
		maintenanceHistoryStore: maintenanceHistoryRepo,
	});

	const deps: DashboardDeps = {
		config: { ...TEST_CONFIG, dbPath },
		projectPath: TEST_PROJECT_PATH,
		embeddingModel: null,
		memoryEngine,
	};

	app = createDashboardApp(deps);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
	try {
		rmSync(`${TEST_PROJECT_PATH}/.open-mem`, { recursive: true, force: true });
	} catch {}
});

describe("HTTP v1 contract", () => {
	test("GET /v1/config/schema returns envelope", async () => {
		const res = await app.request("/v1/config/schema");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<unknown[]>(await res.json());
		expect(Array.isArray(payload.data)).toBe(true);
		expect(payload.error).toBeNull();
	});

	test("GET /v1/memory/observations returns envelope list", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		observationRepo.create({
			sessionId: "sess-1",
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

		const res = await app.request("/v1/memory/observations?limit=10");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ id: string }>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
	});

	test("GET /v1/memory/search validates q", async () => {
		const res = await app.request("/v1/memory/search");
		expect(res.status).toBe(400);
		const payload = parseEnvelope<null>(await res.json());
		expect(payload.error).toBeDefined();
	});

	test("GET /v1/memory/search includes explainability metadata", async () => {
		sessionRepo.create("sess-search", TEST_PROJECT_PATH);
		observationRepo.create({
			sessionId: "sess-search",
			type: "discovery",
			title: "JWT session validation",
			subtitle: "",
			facts: [],
			narrative: "Session token validation logic.",
			concepts: ["jwt"],
			filesRead: ["src/auth.ts"],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			tokenCount: 10,
			discoveryTokens: 10,
		});

		const res = await app.request("/v1/memory/search?q=JWT&limit=5");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ explain?: { matchedBy: string[]; strategy?: string } }>>(
			await res.json(),
		);
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBeGreaterThan(0);
		if (payload.data[0].explain) {
			expect(payload.data[0].explain.matchedBy.length).toBeGreaterThan(0);
		}
	});

	test("GET /v1/memory/observations/:id/lineage returns lineage nodes with state", async () => {
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

		const res = await app.request(`/v1/memory/observations/${second!.id}/lineage`);
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			observationId: string;
			lineage: Array<{ id: string; state: "current" | "superseded" | "tombstoned" }>;
		}>(
			await res.json(),
		);
		expect(payload.error).toBeNull();
		expect(payload.data.observationId).toBe(second!.id);
		expect(payload.data.lineage.length).toBe(2);
		expect(payload.data.lineage[0].id).toBe(first.id);
		expect(payload.data.lineage[1].id).toBe(second!.id);
		expect(payload.data.lineage[0].state).toBe("superseded");
		expect(payload.data.lineage[1].state).toBe("current");
	});

	test("GET /v1/memory/observations/:id/lineage returns 404 when missing", async () => {
		const res = await app.request("/v1/memory/observations/does-not-exist/lineage");
		expect(res.status).toBe(404);
	});

	test("mode and maintenance routes exist", async () => {
		const modes = await app.request("/v1/modes");
		expect(modes.status).toBe(200);

		const dryRun = await app.request("/v1/maintenance/folder-context/dry-run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "clean" }),
		});
		expect(dryRun.status).toBe(200);
	});

	test("GET /v1/health returns queue and memory summary", async () => {
		const res = await app.request("/v1/health");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			status: string;
			queue: { pending: number; mode: string };
			memory: { totalObservations: number; totalSessions: number };
		}>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.status).toBe("ok");
		expect(payload.data.queue).toHaveProperty("pending");
		expect(payload.data.memory).toHaveProperty("totalObservations");
	});

	test("GET /v1/readiness returns readiness envelope", async () => {
		const res = await app.request("/v1/readiness");
		expect([200, 503]).toContain(res.status);
		const payload = parseEnvelope<{ ready: boolean; status: string; reasons: string[] }>(
			await res.json(),
		);
		expect(payload.error).toBeNull();
		expect(typeof payload.data.ready).toBe("boolean");
	});

	test("GET /v1/diagnostics returns diagnostics report", async () => {
		const res = await app.request("/v1/diagnostics");
		expect([200, 503]).toContain(res.status);
		const payload = parseEnvelope<{ ok: boolean; checks: Array<{ id: string; status: string }> }>(
			await res.json(),
		);
		expect(payload.error).toBeNull();
		expect(payload.data.checks.length).toBeGreaterThan(0);
	});

	test("GET /v1/tools/guide returns canonical tool metadata", async () => {
		const res = await app.request("/v1/tools/guide");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			contractVersion: string;
			tools: Array<{ name: string; description: string }>;
		}>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.tools.some((tool) => tool.name === "mem-find")).toBe(true);
	});

	test("queue endpoints do not rely on host header values", async () => {
		const queueRes = await app.request("/v1/queue", { headers: { host: "evil.example.com" } });
		expect(queueRes.status).toBe(200);

		const processRes = await app.request("/v1/queue/process", {
			method: "POST",
			headers: { host: "evil.example.com" },
		});
		expect(processRes.status).toBe(200);
	});

	test("queue endpoints ignore forwarded headers for authorization", async () => {
		const res = await app.request("/v1/queue", {
			headers: {
				host: "localhost:8787",
				"x-forwarded-for": "127.0.0.1, 203.0.113.10",
			},
		});
		expect(res.status).toBe(200);
	});

	test("GET /v1/metrics returns runtime metrics envelope", async () => {
		const res = await app.request("/v1/metrics");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			enqueueCount: number;
			queue: { pending: number };
			batches: { total: number };
			uptimeMs: number;
		}>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data).toHaveProperty("enqueueCount");
		expect(payload.data.queue).toHaveProperty("pending");
		expect(payload.data.batches).toHaveProperty("total");
		expect(payload.data.uptimeMs).toBeGreaterThanOrEqual(0);
	});

	test("GET /v1/platforms returns adapter capability flags", async () => {
		const res = await app.request("/v1/platforms");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			platforms: Array<{
				name: string;
				enabled: boolean;
				capabilities: {
					nativeSessionLifecycle: boolean;
					nativeToolCapture: boolean;
					nativeChatCapture: boolean;
					emulatedIdleFlush: boolean;
				};
			}>;
		}>(await res.json());

		expect(payload.error).toBeNull();
		expect(payload.data.platforms.length).toBe(3);
		const names = payload.data.platforms.map((p) => p.name);
		expect(names).toContain("opencode");
		expect(names).toContain("claude-code");
		expect(names).toContain("cursor");
		expect(payload.data.platforms[0]?.capabilities).toHaveProperty("nativeToolCapture");
	});

	test("GET /v1/memory/observations?state=current filters active observations", async () => {
		sessionRepo.create("sess-state", TEST_PROJECT_PATH);
		const obs = observationRepo.create({
			sessionId: "sess-state",
			type: "discovery",
			title: "Active observation",
			subtitle: "",
			facts: [],
			narrative: "Still active",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});

		const res = await app.request("/v1/memory/observations?state=current");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ id: string }>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
		expect(payload.data[0].id).toBe(obs.id);
	});

	test("GET /v1/memory/observations?state=superseded returns superseded observations", async () => {
		sessionRepo.create("sess-sup", TEST_PROJECT_PATH);
		const first = observationRepo.create({
			sessionId: "sess-sup",
			type: "feature",
			title: "Original",
			subtitle: "",
			facts: [],
			narrative: "Original narrative",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});
		observationRepo.update(first.id, { narrative: "Revised narrative" });

		const res = await app.request("/v1/memory/observations?state=superseded");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ id: string }>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
		expect(payload.data[0].id).toBe(first.id);
	});

	test("GET /v1/memory/observations?state=tombstoned returns deleted observations", async () => {
		sessionRepo.create("sess-tomb", TEST_PROJECT_PATH);
		const obs = observationRepo.create({
			sessionId: "sess-tomb",
			type: "bugfix",
			title: "Deleted obs",
			subtitle: "",
			facts: [],
			narrative: "Will be deleted",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "tool",
			tokenCount: 10,
			discoveryTokens: 10,
		});
		observationRepo.delete(obs.id);

		const res = await app.request("/v1/memory/observations?state=tombstoned");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ id: string }>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
		expect(payload.data[0].id).toBe(obs.id);
	});

	test("GET /v1/memory/observations/:id/revision-diff returns changed fields with summary", async () => {
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

		const res = await app.request(
			`/v1/memory/observations/${first.id}/revision-diff?against=${second!.id}`,
		);
		expect(res.status).toBe(200);
		const payload = parseEnvelope<{
			fromId: string;
			toId: string;
			summary: string;
			changedFields: Array<{
				field:
					| "title"
					| "subtitle"
					| "narrative"
					| "type"
					| "facts"
					| "concepts"
					| "filesRead"
					| "filesModified"
					| "importance";
				before: unknown;
				after: unknown;
			}>;
		}>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.fromId).toBe(second!.id);
		expect(payload.data.toId).toBe(first.id);
		expect(payload.data.summary).toContain("Changed");
		expect(payload.data.changedFields.length).toBeGreaterThan(0);
		const titleChange = payload.data.changedFields.find((c) => c.field === "title");
		expect(titleChange).toBeDefined();
		expect(titleChange!.before).toBe("Updated title");
		expect(titleChange!.after).toBe("Original title");
	});

	test("GET /v1/memory/observations/:id/revision-diff requires against param", async () => {
		const res = await app.request("/v1/memory/observations/some-id/revision-diff");
		expect(res.status).toBe(400);
	});

	test("GET /v1/adapters/status returns adapter list", async () => {
		const res = await app.request("/v1/adapters/status");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<
			Array<{
				name: string;
				version: string;
				enabled: boolean;
				capabilities: Record<string, boolean>;
			}>
		>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(3);
		const names = payload.data.map((a) => a.name);
		expect(names).toContain("opencode");
		expect(names).toContain("claude-code");
		expect(names).toContain("cursor");
		expect(payload.data[0].capabilities).toHaveProperty("nativeToolCapture");
	});

	test("GET /v1/config/audit returns empty timeline initially", async () => {
		const res = await app.request("/v1/config/audit");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<unknown>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data).toEqual([]);
	});

	test("PATCH /v1/config tracks audit and GET /v1/config/audit returns it", async () => {
		const patchRes = await app.request("/v1/config", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ batchSize: 10 }),
		});
		expect(patchRes.status).toBe(200);

		const auditRes = await app.request("/v1/config/audit");
		expect(auditRes.status).toBe(200);
		const payload = parseEnvelope<
			Array<{ id: string; patch: Record<string, unknown>; source: string }>
		>(await auditRes.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
		expect(payload.data[0].patch).toHaveProperty("batchSize");
		expect(payload.data[0].source).toBe("api");
	});

	test("POST /v1/config/rollback reverts a config change", async () => {
		await app.request("/v1/config", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ batchSize: 10 }),
		});

		const auditRes = await app.request("/v1/config/audit");
		const auditPayload = parseEnvelope<Array<{ id: string }>>(await auditRes.json());
		const eventId = auditPayload.data[0].id;

		const rollbackRes = await app.request("/v1/config/rollback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ eventId }),
		});
		expect(rollbackRes.status).toBe(200);
		const rollbackPayload = parseEnvelope<{ id: string; source: string }>(await rollbackRes.json());
		expect(rollbackPayload.error).toBeNull();
		expect(rollbackPayload.data.source).toBe("rollback");
	});

	test("POST /v1/config/rollback returns 404 for unknown event", async () => {
		const res = await app.request("/v1/config/rollback", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ eventId: "nonexistent" }),
		});
		expect(res.status).toBe(404);
	});

	test("GET /v1/maintenance/history returns empty initially", async () => {
		const res = await app.request("/v1/maintenance/history");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<unknown>>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data).toEqual([]);
	});

	test("maintenance operations are tracked in history", async () => {
		await app.request("/v1/maintenance/folder-context/dry-run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action: "clean" }),
		});

		const res = await app.request("/v1/maintenance/history");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<Array<{ id: string; action: string; dryRun: boolean }>>(
			await res.json(),
		);
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBe(1);
		expect(payload.data[0].action).toContain("folder-context");
		expect(payload.data[0].dryRun).toBe(true);
	});

	test("search results include rankingSource field", async () => {
		sessionRepo.create("sess-rank", TEST_PROJECT_PATH);
		observationRepo.create({
			sessionId: "sess-rank",
			type: "discovery",
			title: "Ranking source test",
			subtitle: "",
			facts: [],
			narrative: "Testing ranking source tracking.",
			concepts: ["ranking"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			tokenCount: 10,
			discoveryTokens: 10,
		});

		const res = await app.request("/v1/memory/search?q=ranking&limit=5");
		expect(res.status).toBe(200);
		const payload = parseEnvelope<
			Array<{
				rankingSource?: string;
				explain?: { matchedBy: string[]; signals?: Array<{ source: string }> };
			}>
		>(await res.json());
		expect(payload.error).toBeNull();
		expect(payload.data.length).toBeGreaterThan(0);
		if (payload.data[0].rankingSource !== undefined) {
			expect(typeof payload.data[0].rankingSource).toBe("string");
		}
	});
});
