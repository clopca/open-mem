import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DefaultMemoryEngine } from "../../src/core/memory-engine";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let sessions: SessionRepository;
let observations: ObservationRepository;
let summaries: SummaryRepository;
let engine: DefaultMemoryEngine;

const PROJECT_PATH = "/tmp/anchor-test-proj";

function createEngine() {
	return new DefaultMemoryEngine({
		observations,
		sessions,
		summaries,
		searchOrchestrator: new SearchOrchestrator(observations, null, false),
		projectPath: PROJECT_PATH,
		config: {
			dbPath: dbPath,
			provider: "google",
			apiKey: undefined,
			model: "test",
			maxTokensPerCompression: 1024,
			compressionEnabled: false,
			contextInjectionEnabled: false,
			maxContextTokens: 4000,
			batchSize: 5,
			batchIntervalMs: 30000,
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
			rateLimitingEnabled: false,
			folderContextEnabled: false,
			folderContextMaxDepth: 5,
			folderContextMode: "dispersed",
			folderContextFilename: "AGENTS.md",
			daemonEnabled: false,
			dashboardEnabled: false,
			dashboardPort: 3737,
			conflictResolutionEnabled: false,
			conflictSimilarityBandLow: 0.7,
			conflictSimilarityBandHigh: 0.95,
			userMemoryEnabled: false,
			userMemoryDbPath: "",
			userMemoryMaxContextTokens: 1000,
			rerankingEnabled: false,
			rerankingMaxCandidates: 20,
			entityExtractionEnabled: false,
		},
	});
}

function createObservationAt(
	sessionId: string,
	title: string,
	createdAt: string,
	type: "discovery" | "decision" | "bugfix" = "discovery",
) {
	const obs = observations.create({
		sessionId,
		type,
		title,
		subtitle: "",
		facts: [],
		narrative: `Narrative for ${title}`,
		concepts: [],
		filesRead: [],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "test",
		tokenCount: 10,
		discoveryTokens: 0,
		importance: 3,
	});
	db.run("UPDATE observations SET created_at = ? WHERE id = ?", [createdAt, obs.id]);
	return { ...obs, createdAt };
}

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	sessions = new SessionRepository(db);
	observations = new ObservationRepository(db);
	summaries = new SummaryRepository(db);
	engine = createEngine();
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

describe("timeline anchor navigation", () => {
	test("anchor with valid ID returns surrounding observations in chronological order", async () => {
		sessions.create("sess-1", PROJECT_PATH);
		sessions.create("sess-2", PROJECT_PATH);

		const obs1 = createObservationAt("sess-1", "First obs", "2025-01-01T10:00:00.000Z");
		const obs2 = createObservationAt("sess-1", "Second obs", "2025-01-01T11:00:00.000Z");
		const obs3 = createObservationAt("sess-2", "Third obs (anchor)", "2025-01-01T12:00:00.000Z");
		const obs4 = createObservationAt("sess-2", "Fourth obs", "2025-01-01T13:00:00.000Z");
		const obs5 = createObservationAt("sess-1", "Fifth obs", "2025-01-01T14:00:00.000Z");

		const anchorId = observations.getBySession("sess-2")[0].id;
		const result = await engine.timeline({
			anchor: anchorId,
			depthBefore: 5,
			depthAfter: 5,
		});

		expect(result).toHaveLength(1);
		const obs = result[0].observations;
		expect(obs.length).toBeGreaterThanOrEqual(3);

		const titles = obs.map((o) => o.title);
		expect(titles).toContain("Third obs (anchor)");

		const timestamps = obs.map((o) => new Date(o.createdAt).getTime());
		for (let i = 1; i < timestamps.length; i++) {
			expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
		}
	});

	test("anchor with invalid ID returns empty results", async () => {
		sessions.create("sess-1", PROJECT_PATH);
		createObservationAt("sess-1", "Some obs", "2025-01-01T10:00:00.000Z");

		const result = await engine.timeline({ anchor: "nonexistent-id" });
		expect(result).toHaveLength(0);
	});

	test("no anchor parameter preserves existing session-level timeline behavior", async () => {
		sessions.create("sess-1", PROJECT_PATH);
		sessions.create("sess-2", PROJECT_PATH);
		createObservationAt("sess-1", "Obs A", "2025-01-01T10:00:00.000Z");
		createObservationAt("sess-2", "Obs B", "2025-01-02T10:00:00.000Z");

		const result = await engine.timeline({ limit: 5 });
		expect(result.length).toBeGreaterThanOrEqual(1);
		for (const entry of result) {
			expect(entry.session).toBeDefined();
			expect(entry.session.id).toBeDefined();
		}
	});

	test("depthBefore=0 returns only anchor + after observations", async () => {
		sessions.create("sess-1", PROJECT_PATH);

		createObservationAt("sess-1", "Before 1", "2025-01-01T09:00:00.000Z");
		createObservationAt("sess-1", "Before 2", "2025-01-01T10:00:00.000Z");
		const anchorObs = createObservationAt("sess-1", "Anchor", "2025-01-01T11:00:00.000Z");
		createObservationAt("sess-1", "After 1", "2025-01-01T12:00:00.000Z");
		createObservationAt("sess-1", "After 2", "2025-01-01T13:00:00.000Z");

		const allObs = observations.getBySession("sess-1");
		const anchorId = allObs.find((o) => o.title === "Anchor")!.id;

		const result = await engine.timeline({
			anchor: anchorId,
			depthBefore: 0,
			depthAfter: 5,
		});

		expect(result).toHaveLength(1);
		const titles = result[0].observations.map((o) => o.title);
		expect(titles).not.toContain("Before 1");
		expect(titles).not.toContain("Before 2");
		expect(titles).toContain("Anchor");
		expect(titles).toContain("After 1");
		expect(titles).toContain("After 2");
	});

	test("cross-session observations are included when anchor is used", async () => {
		sessions.create("sess-A", PROJECT_PATH);
		sessions.create("sess-B", PROJECT_PATH);
		sessions.create("sess-C", PROJECT_PATH);

		createObservationAt("sess-A", "Session A obs", "2025-01-01T08:00:00.000Z");
		createObservationAt("sess-B", "Session B obs (anchor)", "2025-01-01T10:00:00.000Z");
		createObservationAt("sess-C", "Session C obs", "2025-01-01T12:00:00.000Z");

		const allSessBObs = observations.getBySession("sess-B");
		const anchorId = allSessBObs[0].id;

		const result = await engine.timeline({
			anchor: anchorId,
			depthBefore: 5,
			depthAfter: 5,
		});

		expect(result).toHaveLength(1);
		const titles = result[0].observations.map((o) => o.title);
		expect(titles).toContain("Session A obs");
		expect(titles).toContain("Session B obs (anchor)");
		expect(titles).toContain("Session C obs");

		const sessionIds = new Set(result[0].observations.map((o) => o.sessionId));
		expect(sessionIds.size).toBe(3);
	});

	test("depthAfter=0 returns only before + anchor observations", async () => {
		sessions.create("sess-1", PROJECT_PATH);

		createObservationAt("sess-1", "Before 1", "2025-01-01T09:00:00.000Z");
		createObservationAt("sess-1", "Anchor", "2025-01-01T11:00:00.000Z");
		createObservationAt("sess-1", "After 1", "2025-01-01T13:00:00.000Z");

		const allObs = observations.getBySession("sess-1");
		const anchorId = allObs.find((o) => o.title === "Anchor")!.id;

		const result = await engine.timeline({
			anchor: anchorId,
			depthBefore: 5,
			depthAfter: 0,
		});

		expect(result).toHaveLength(1);
		const titles = result[0].observations.map((o) => o.title);
		expect(titles).toContain("Before 1");
		expect(titles).toContain("Anchor");
		expect(titles).not.toContain("After 1");
	});

	test("anchor respects depth limits", async () => {
		sessions.create("sess-1", PROJECT_PATH);

		for (let i = 0; i < 10; i++) {
			createObservationAt(
				"sess-1",
				`Before ${i}`,
				`2025-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
			);
		}
		createObservationAt("sess-1", "Anchor", "2025-01-01T10:00:00.000Z");
		for (let i = 0; i < 10; i++) {
			createObservationAt(
				"sess-1",
				`After ${i}`,
				`2025-01-01T${String(11 + i).padStart(2, "0")}:00:00.000Z`,
			);
		}

		const allObs = observations.getBySession("sess-1");
		const anchorId = allObs.find((o) => o.title === "Anchor")!.id;

		const result = await engine.timeline({
			anchor: anchorId,
			depthBefore: 2,
			depthAfter: 3,
		});

		expect(result).toHaveLength(1);
		const obs = result[0].observations;
		const beforeAnchor = obs.filter((o) => o.createdAt < "2025-01-01T10:00:00.000Z");
		const afterAnchor = obs.filter((o) => o.createdAt > "2025-01-01T10:00:00.000Z");
		expect(beforeAnchor).toHaveLength(2);
		expect(afterAnchor).toHaveLength(3);
	});
});
