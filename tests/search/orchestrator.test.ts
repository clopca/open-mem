import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { cleanupTestDb, createTestDb } from "../db/helpers";

describe("SearchOrchestrator", () => {
	let db: Database;
	let dbPath: string;
	let sessions: SessionRepository;
	let observations: ObservationRepository;
	let orchestrator: SearchOrchestrator;

	beforeEach(() => {
		const result = createTestDb();
		db = result.db;
		dbPath = result.dbPath;
		sessions = new SessionRepository(db);
		observations = new ObservationRepository(db);
		orchestrator = new SearchOrchestrator(observations, null, false);
	});

	afterEach(() => {
		db.close();
		cleanupTestDb(dbPath);
	});

	function seedProjectA() {
		sessions.create("sess-a", "/project/alpha");
		observations.create({
			sessionId: "sess-a",
			type: "discovery",
			title: "Alpha JWT authentication pattern",
			subtitle: "In auth module",
			facts: ["Uses RS256"],
			narrative: "Alpha project uses JWT tokens with RS256.",
			concepts: ["JWT", "authentication"],
			filesRead: ["src/auth.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
			discoveryTokens: 0,
			importance: 3,
		});
		observations.create({
			sessionId: "sess-a",
			type: "refactor",
			title: "Alpha React component refactoring",
			subtitle: "",
			facts: [],
			narrative: "Refactored React components in alpha project.",
			concepts: ["react", "hooks"],
			filesRead: [],
			filesModified: ["src/App.tsx"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 30,
			discoveryTokens: 0,
			importance: 3,
		});
	}

	function seedProjectB() {
		sessions.create("sess-b", "/project/beta");
		observations.create({
			sessionId: "sess-b",
			type: "bugfix",
			title: "Beta database connection fix",
			subtitle: "Connection pooling",
			facts: ["Pool size was wrong"],
			narrative: "Fixed database connection pooling in beta project.",
			concepts: ["database", "connection"],
			filesRead: ["src/db.ts"],
			filesModified: ["src/db.ts"],
			rawToolOutput: "raw",
			toolName: "Edit",
			tokenCount: 40,
			discoveryTokens: 0,
			importance: 3,
		});
		observations.create({
			sessionId: "sess-b",
			type: "discovery",
			title: "Beta JWT token validation",
			subtitle: "",
			facts: [],
			narrative: "Beta project JWT validation approach.",
			concepts: ["JWT", "validation"],
			filesRead: ["src/auth.ts"],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 35,
			discoveryTokens: 0,
			importance: 3,
		});
	}

	// =========================================================================
	// Project Isolation
	// =========================================================================

	describe("project isolation", () => {
		test("FTS5 search only returns results from the specified project", async () => {
			seedProjectA();
			seedProjectB();

			const alphaResults = await orchestrator.search("JWT", {
				strategy: "filter-only",
				projectPath: "/project/alpha",
			});

			expect(alphaResults.length).toBe(1);
			expect(alphaResults[0].observation.title).toContain("Alpha");
		});

		test("observations from project A don't appear in search for project B", async () => {
			seedProjectA();
			seedProjectB();

			const betaResults = await orchestrator.search("React", {
				strategy: "filter-only",
				projectPath: "/project/beta",
			});

			expect(betaResults.length).toBe(0);
		});

		test("searchByConcept respects project isolation", async () => {
			seedProjectA();
			seedProjectB();

			const alphaResults = await orchestrator.search("JWT", {
				strategy: "filter-only",
				concept: "JWT",
				projectPath: "/project/alpha",
			});

			expect(alphaResults.length).toBe(1);
			expect(alphaResults[0].observation.title).toContain("Alpha");
		});

		test("searchByFile respects project isolation", async () => {
			seedProjectA();
			seedProjectB();

			const alphaResults = await orchestrator.search("auth", {
				strategy: "filter-only",
				file: "src/auth.ts",
				projectPath: "/project/alpha",
			});

			expect(alphaResults.length).toBe(1);
			expect(alphaResults[0].observation.title).toContain("Alpha");
		});
	});

	// =========================================================================
	// Hybrid Strategy (default)
	// =========================================================================

	describe("hybrid strategy", () => {
		test("hybrid is the default strategy", async () => {
			seedProjectA();

			const results = await orchestrator.search("JWT", {
				projectPath: "/project/alpha",
			});

			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].observation.title).toContain("JWT");
		});

		test("hybrid strategy returns same results as hybridSearch for FTS-only", async () => {
			seedProjectA();

			const { hybridSearch } = await import("../../src/search/hybrid");
			const directResults = await hybridSearch("JWT", observations, null, {
				projectPath: "/project/alpha",
				limit: 10,
			});

			const orchestratedResults = await orchestrator.search("JWT", {
				strategy: "hybrid",
				projectPath: "/project/alpha",
				limit: 10,
			});

			expect(orchestratedResults.length).toBe(directResults.length);
			if (directResults.length > 0) {
				expect(orchestratedResults[0].observation.id).toBe(directResults[0].observation.id);
			}
		});

		test("hybrid strategy honors singular concept filter options", async () => {
			seedProjectA();

			const results = await orchestrator.search("project", {
				strategy: "hybrid",
				concept: "authentication",
				projectPath: "/project/alpha",
				limit: 10,
			});

			expect(results.length).toBeGreaterThanOrEqual(1);
			for (const result of results) {
				expect(result.observation.concepts).toContain("authentication");
			}
		});
	});

	// =========================================================================
	// Filter-Only Strategy
	// =========================================================================

	describe("filter-only strategy", () => {
		test("filter-only with concept uses searchByConcept", async () => {
			seedProjectA();

			const results = await orchestrator.search("anything", {
				strategy: "filter-only",
				concept: "authentication",
				projectPath: "/project/alpha",
			});

			expect(results.length).toBe(1);
			expect(results[0].observation.concepts).toContain("authentication");
		});

		test("filter-only with file uses searchByFile", async () => {
			seedProjectA();

			const results = await orchestrator.search("anything", {
				strategy: "filter-only",
				file: "src/App.tsx",
				projectPath: "/project/alpha",
			});

			expect(results.length).toBe(1);
			expect(results[0].observation.filesModified).toContain("src/App.tsx");
		});

		test("filter-only without concept/file uses FTS5 search", async () => {
			seedProjectA();

			const results = await orchestrator.search("JWT authentication", {
				strategy: "filter-only",
				projectPath: "/project/alpha",
			});

			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].observation.title).toContain("JWT");
		});

		test("filter-only respects type filter", async () => {
			seedProjectA();

			const results = await orchestrator.search("JWT OR React", {
				strategy: "filter-only",
				type: "discovery",
				projectPath: "/project/alpha",
			});

			for (const r of results) {
				expect(r.observation.type).toBe("discovery");
			}
		});

		test("filter-only respects limit", async () => {
			seedProjectA();

			const results = await orchestrator.search("JWT OR React", {
				strategy: "filter-only",
				projectPath: "/project/alpha",
				limit: 1,
			});

			expect(results.length).toBeLessThanOrEqual(1);
		});
	});

	// =========================================================================
	// Semantic Strategy
	// =========================================================================

	describe("semantic strategy", () => {
		test("semantic falls back to filter-only when no embedding model", async () => {
			seedProjectA();

			const results = await orchestrator.search("JWT", {
				strategy: "semantic",
				projectPath: "/project/alpha",
			});

			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results[0].observation.title).toContain("JWT");
		});
	});

	// =========================================================================
	// FTS5 search projectPath in observations.search()
	// =========================================================================

	describe("observations.search() project isolation", () => {
		test("search with projectPath only returns matching project observations", () => {
			seedProjectA();
			seedProjectB();

			const results = observations.search({
				query: "JWT",
				projectPath: "/project/alpha",
			});

			expect(results.length).toBe(1);
			expect(results[0].observation.title).toContain("Alpha");
		});

		test("search without projectPath returns all projects", () => {
			seedProjectA();
			seedProjectB();

			const results = observations.search({ query: "JWT" });

			expect(results.length).toBe(2);
		});
	});
});
