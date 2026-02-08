import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { Hono } from "hono";
import { createDashboardApp, type DashboardDeps } from "../../src/adapters/http/server";
import { DefaultMemoryEngine } from "../../src/core/memory-engine";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { createObservationStore, createSessionStore, createSummaryStore } from "../../src/store/sqlite/adapters";
import type { OpenMemConfig } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let app: Hono;
let observationRepo: ObservationRepository;
let sessionRepo: SessionRepository;
let summaryRepo: SummaryRepository;

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

function parseEnvelope<T>(json: unknown): { data: T; error: unknown; meta: Record<string, unknown> } {
  return json as { data: T; error: unknown; meta: Record<string, unknown> };
}

beforeEach(() => {
  const result = createTestDb();
  db = result.db;
  dbPath = result.dbPath;

  observationRepo = new ObservationRepository(db);
  sessionRepo = new SessionRepository(db);
  summaryRepo = new SummaryRepository(db);

  const memoryEngine = new DefaultMemoryEngine({
    observations: createObservationStore(observationRepo),
    sessions: createSessionStore(sessionRepo),
    summaries: createSummaryStore(summaryRepo),
    searchOrchestrator: new SearchOrchestrator(observationRepo, null, false, null, null, null),
    projectPath: TEST_PROJECT_PATH,
    config: { ...TEST_CONFIG, dbPath },
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
    const payload = parseEnvelope<
      Array<{ explain?: { matchedBy: string[]; strategy?: string } }>
    >(await res.json());
    expect(payload.error).toBeNull();
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.data[0].explain?.matchedBy.length).toBeGreaterThan(0);
  });

  test("GET /v1/memory/observations/:id/lineage returns revision chain", async () => {
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
    const second = observationRepo.update(first.id, { narrative: "Implemented improved behavior." });
    expect(second).not.toBeNull();

    const res = await app.request(`/v1/memory/observations/${second!.id}/lineage`);
    expect(res.status).toBe(200);
    const payload = parseEnvelope<{ observationId: string; lineage: Array<{ id: string }> }>(
      await res.json(),
    );
    expect(payload.error).toBeNull();
    expect(payload.data.observationId).toBe(second!.id);
    expect(payload.data.lineage.length).toBe(2);
    expect(payload.data.lineage[0].id).toBe(first.id);
    expect(payload.data.lineage[1].id).toBe(second!.id);
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
});
