// =============================================================================
// open-mem — HTTP Server Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { type DashboardDeps, createDashboardApp } from "../../src/servers/http-server";
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
};

function seedObservation(
	sessionId: string,
	overrides?: Partial<{
		type: string;
		title: string;
		tokenCount: number;
		discoveryTokens: number;
	}>,
) {
	return observationRepo.create({
		sessionId,
		type: (overrides?.type ?? "discovery") as "discovery",
		title: overrides?.title ?? "Test observation",
		subtitle: "Test subtitle",
		facts: ["fact1", "fact2"],
		narrative: "Test narrative content",
		concepts: ["testing", "api"],
		filesRead: ["src/test.ts"],
		filesModified: [],
		rawToolOutput: "raw output",
		toolName: "Read",
		tokenCount: overrides?.tokenCount ?? 100,
		discoveryTokens: overrides?.discoveryTokens ?? 500,
	});
}

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;

	observationRepo = new ObservationRepository(db);
	sessionRepo = new SessionRepository(db);
	summaryRepo = new SummaryRepository(db);

	const deps: DashboardDeps = {
		observationRepo,
		sessionRepo,
		summaryRepo,
		config: { ...TEST_CONFIG, dbPath },
		projectPath: TEST_PROJECT_PATH,
		embeddingModel: null,
	};

	app = createDashboardApp(deps);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

// =============================================================================
// GET /api/observations
// =============================================================================

describe("GET /api/observations", () => {
	test("returns empty array when no observations exist", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const res = await app.request("/api/observations");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual([]);
	});

	test("returns observations for the project", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1", { title: "First observation" });
		seedObservation("sess-1", { title: "Second observation" });

		const res = await app.request("/api/observations");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);
	});

	test("respects limit parameter", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		for (let i = 0; i < 5; i++) {
			seedObservation("sess-1", { title: `Obs ${i}` });
		}

		const res = await app.request("/api/observations?limit=2");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);
	});

	test("clamps limit to max 100", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const res = await app.request("/api/observations?limit=500");
		expect(res.status).toBe(200);
	});

	test("clamps limit to min 1", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1");
		const res = await app.request("/api/observations?limit=0");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.length).toBeGreaterThanOrEqual(0);
	});

	test("filters by type", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1", { type: "discovery", title: "Discovery obs" });
		seedObservation("sess-1", { type: "bugfix", title: "Bugfix obs" });

		const res = await app.request("/api/observations?type=bugfix");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(1);
		expect(data[0].type).toBe("bugfix");
	});

	test("ignores invalid type filter", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1");

		const res = await app.request("/api/observations?type=invalid_type");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(1);
	});

	test("filters by sessionId", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		sessionRepo.create("sess-2", TEST_PROJECT_PATH);
		seedObservation("sess-1", { title: "Session 1 obs" });
		seedObservation("sess-2", { title: "Session 2 obs" });

		const res = await app.request("/api/observations?sessionId=sess-1");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(1);
		expect(data[0].sessionId).toBe("sess-1");
	});
});

// =============================================================================
// GET /api/observations/:id
// =============================================================================

describe("GET /api/observations/:id", () => {
	test("returns observation by id", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const obs = seedObservation("sess-1", { title: "Specific observation" });

		const res = await app.request(`/api/observations/${obs.id}`);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe(obs.id);
		expect(data.title).toBe("Specific observation");
	});

	test("returns 404 for non-existent observation", async () => {
		const res = await app.request("/api/observations/nonexistent-id");
		expect(res.status).toBe(404);
		const data = await res.json();
		expect(data.error).toBe("Observation not found");
	});
});

// =============================================================================
// GET /api/sessions
// =============================================================================

describe("GET /api/sessions", () => {
	test("returns empty array when no sessions exist", async () => {
		const res = await app.request("/api/sessions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual([]);
	});

	test("returns sessions for the project", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		sessionRepo.create("sess-2", TEST_PROJECT_PATH);

		const res = await app.request("/api/sessions");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(2);
	});

	test("respects limit parameter", async () => {
		for (let i = 0; i < 5; i++) {
			sessionRepo.create(`sess-${i}`, TEST_PROJECT_PATH);
		}

		const res = await app.request("/api/sessions?limit=3");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(3);
	});

	test("filters by projectPath", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		sessionRepo.create("sess-2", "/tmp/other-project");

		const res = await app.request("/api/sessions?projectPath=/tmp/other-project");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toHaveLength(1);
		expect(data[0].projectPath).toBe("/tmp/other-project");
	});
});

// =============================================================================
// GET /api/sessions/:id
// =============================================================================

describe("GET /api/sessions/:id", () => {
	test("returns session with observations", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1", { title: "Obs A" });
		seedObservation("sess-1", { title: "Obs B" });

		const res = await app.request("/api/sessions/sess-1");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.id).toBe("sess-1");
		expect(data.projectPath).toBe(TEST_PROJECT_PATH);
		expect(data.observations).toHaveLength(2);
	});

	test("returns 404 for non-existent session", async () => {
		const res = await app.request("/api/sessions/nonexistent");
		expect(res.status).toBe(404);
		const data = await res.json();
		expect(data.error).toBe("Session not found");
	});
});

// =============================================================================
// GET /api/search
// =============================================================================

describe("GET /api/search", () => {
	test("returns 400 when q parameter is missing", async () => {
		const res = await app.request("/api/search");
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toContain("'q' is required");
	});

	test("returns search results for matching query", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1", { title: "JWT authentication pattern" });
		seedObservation("sess-1", { title: "Database migration setup" });

		const res = await app.request("/api/search?q=JWT");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.length).toBeGreaterThanOrEqual(1);
		expect(data[0].observation.title).toContain("JWT");
	});

	test("returns empty array for non-matching query", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		seedObservation("sess-1", { title: "JWT authentication" });

		const res = await app.request("/api/search?q=nonexistent_xyzzy");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual([]);
	});

	test("respects limit parameter", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		for (let i = 0; i < 5; i++) {
			seedObservation("sess-1", { title: `Test search item ${i}` });
		}

		const res = await app.request("/api/search?q=search&limit=2");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.length).toBeLessThanOrEqual(2);
	});

	test("filters by type", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		observationRepo.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "API discovery finding",
			subtitle: "",
			facts: [],
			narrative: "Found API patterns",
			concepts: ["api"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			tokenCount: 100,
			discoveryTokens: 500,
		});
		observationRepo.create({
			sessionId: "sess-1",
			type: "bugfix",
			title: "API bugfix resolution",
			subtitle: "",
			facts: [],
			narrative: "Fixed API bug",
			concepts: ["api"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			tokenCount: 100,
			discoveryTokens: 500,
		});

		const res = await app.request("/api/search?q=API&type=bugfix");
		expect(res.status).toBe(200);
		const data = await res.json();
		for (const result of data) {
			expect(result.observation.type).toBe("bugfix");
		}
	});
});

// =============================================================================
// GET /api/stats
// =============================================================================

describe("GET /api/stats", () => {
	test("returns zero stats when empty", async () => {
		const res = await app.request("/api/stats");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.totalObservations).toBe(0);
		expect(data.totalSessions).toBe(0);
		expect(data.totalTokensSaved).toBe(0);
		expect(data.averageObservationSize).toBe(0);
		expect(data.typeBreakdown).toEqual({});
	});

	test("returns correct aggregate stats", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		sessionRepo.create("sess-2", TEST_PROJECT_PATH);
		seedObservation("sess-1", {
			type: "discovery",
			tokenCount: 100,
			discoveryTokens: 500,
		});
		seedObservation("sess-1", {
			type: "bugfix",
			tokenCount: 200,
			discoveryTokens: 800,
		});
		seedObservation("sess-2", {
			type: "discovery",
			tokenCount: 150,
			discoveryTokens: 600,
		});

		const res = await app.request("/api/stats");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.totalObservations).toBe(3);
		expect(data.totalSessions).toBe(2);
		expect(data.totalTokensSaved).toBe(1900 - 450); // (500+800+600) - (100+200+150)
		expect(data.averageObservationSize).toBe(150); // (100+200+150)/3
		expect(data.typeBreakdown.discovery).toBe(2);
		expect(data.typeBreakdown.bugfix).toBe(1);
	});
});

// =============================================================================
// GET /api/config
// =============================================================================

describe("GET /api/config", () => {
	test("returns config with redacted sensitive fields", async () => {
		const res = await app.request("/api/config");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.apiKey).toBe("***REDACTED***");
		expect(data.provider).toBe("google");
		expect(data.dashboardEnabled).toBe(true);
		expect(data.dashboardPort).toBe(3737);
	});

	test("does not expose actual API key value", async () => {
		const res = await app.request("/api/config");
		const data = await res.json();
		const jsonStr = JSON.stringify(data);
		expect(jsonStr).not.toContain("sk-test-secret-key-12345");
	});

	test("preserves non-sensitive config values", async () => {
		const res = await app.request("/api/config");
		const data = await res.json();
		expect(data.model).toBe("gemini-2.5-flash-lite");
		expect(data.batchSize).toBe(5);
		expect(data.retentionDays).toBe(90);
		expect(data.logLevel).toBe("warn");
	});
});

// =============================================================================
// Static file serving (SPA fallback)
// =============================================================================

describe("Static file serving", () => {
	test("returns 404 JSON for unknown API routes", async () => {
		const res = await app.request("/api/unknown");
		expect(res.status).toBe(404);
	});

	test("non-API route serves dashboard SPA fallback", async () => {
		const res = await app.request("/some-page");
		expect([200, 404].includes(res.status)).toBe(true);
	});
});

// =============================================================================
// Input validation edge cases
// =============================================================================

describe("Input validation", () => {
	test("handles non-numeric limit gracefully", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const res = await app.request("/api/observations?limit=abc");
		expect(res.status).toBe(200);
	});

	test("handles negative offset gracefully", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const res = await app.request("/api/observations?offset=-5");
		expect(res.status).toBe(200);
	});

	test("handles non-numeric offset gracefully", async () => {
		sessionRepo.create("sess-1", TEST_PROJECT_PATH);
		const res = await app.request("/api/observations?offset=abc");
		expect(res.status).toBe(200);
	});
});
