// =============================================================================
// open-mem — Advanced Filter Tests (Task 12)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { cleanupTestDb, createTestDb } from "../db/helpers";

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

// ---------------------------------------------------------------------------
// Seed varied observations for filter testing
// ---------------------------------------------------------------------------

function seedFilterData() {
	sessions.create("sess-filter", "/project/filters");

	observations.create({
		sessionId: "sess-filter",
		type: "discovery",
		title: "High importance authentication discovery",
		subtitle: "Critical auth finding",
		facts: ["Uses OAuth2"],
		narrative: "Found critical authentication pattern using OAuth2.",
		concepts: ["authentication", "OAuth2"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 50,
		discoveryTokens: 100,
		importance: 5,
	});

	observations.create({
		sessionId: "sess-filter",
		type: "bugfix",
		title: "Low importance database bugfix",
		subtitle: "Minor fix",
		facts: ["Pool size corrected"],
		narrative: "Fixed minor database connection pool sizing issue.",
		concepts: ["database", "connection-pool"],
		filesRead: ["src/db.ts"],
		filesModified: ["src/db.ts"],
		rawToolOutput: "raw",
		toolName: "Edit",
		tokenCount: 40,
		discoveryTokens: 80,
		importance: 1,
	});

	observations.create({
		sessionId: "sess-filter",
		type: "feature",
		title: "Medium importance API feature",
		subtitle: "REST endpoints",
		facts: ["Added CRUD endpoints"],
		narrative: "Implemented REST API endpoints for user management.",
		concepts: ["API", "REST", "authentication"],
		filesRead: [],
		filesModified: ["src/api/routes.ts", "src/api/controllers.ts"],
		rawToolOutput: "raw",
		toolName: "Edit",
		tokenCount: 60,
		discoveryTokens: 120,
		importance: 3,
	});

	observations.create({
		sessionId: "sess-filter",
		type: "refactor",
		title: "Refactored testing utilities",
		subtitle: "Test helpers",
		facts: ["Extracted common patterns"],
		narrative: "Refactored testing utilities to reduce duplication.",
		concepts: ["testing", "refactoring"],
		filesRead: ["tests/helpers.ts"],
		filesModified: ["tests/helpers.ts", "tests/utils.ts"],
		rawToolOutput: "raw",
		toolName: "Edit",
		tokenCount: 35,
		discoveryTokens: 70,
		importance: 2,
	});
}

// =============================================================================
// Importance Filters
// =============================================================================

describe("importance filters", () => {
	test("importance_min filters out low-importance results", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 3,
			},
		);

		for (const r of results) {
			expect(r.observation.importance).toBeGreaterThanOrEqual(3);
		}
		expect(results.length).toBe(2);
	});

	test("importance_max filters out high-importance results", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMax: 2,
			},
		);

		for (const r of results) {
			expect(r.observation.importance).toBeLessThanOrEqual(2);
		}
		expect(results.length).toBe(2);
	});

	test("importance_min and importance_max combined", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 2,
				importanceMax: 3,
			},
		);

		for (const r of results) {
			expect(r.observation.importance).toBeGreaterThanOrEqual(2);
			expect(r.observation.importance).toBeLessThanOrEqual(3);
		}
		expect(results.length).toBe(2);
	});
});

// =============================================================================
// Date Filters
// =============================================================================

describe("date filters", () => {
	test("createdAfter filters out older observations", async () => {
		seedFilterData();

		const futureDate = new Date(Date.now() + 86400000).toISOString();
		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				createdAfter: futureDate,
			},
		);

		expect(results.length).toBe(0);
	});

	test("createdBefore filters out newer observations", async () => {
		seedFilterData();

		const pastDate = new Date(Date.now() - 86400000).toISOString();
		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				createdBefore: pastDate,
			},
		);

		expect(results.length).toBe(0);
	});

	test("createdAfter with past date returns all observations", async () => {
		seedFilterData();

		const pastDate = new Date(Date.now() - 86400000).toISOString();
		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				createdAfter: pastDate,
			},
		);

		expect(results.length).toBe(4);
	});
});

// =============================================================================
// Concept Filters
// =============================================================================

describe("concept filters", () => {
	test("filters by single concept", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				concepts: ["database"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.concepts).toContain("database");
	});

	test("filters by multiple concepts (OR logic)", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				concepts: ["database", "testing"],
			},
		);

		expect(results.length).toBe(2);
		for (const r of results) {
			const hasConcept =
				r.observation.concepts.some((c) => c.toLowerCase().includes("database")) ||
				r.observation.concepts.some((c) => c.toLowerCase().includes("testing"));
			expect(hasConcept).toBe(true);
		}
	});

	test("concept filter with no matches returns empty", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				concepts: ["nonexistent-concept"],
			},
		);

		expect(results.length).toBe(0);
	});
});

// =============================================================================
// File Filters
// =============================================================================

describe("file filters", () => {
	test("filters by file path", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				files: ["src/auth.ts"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.title).toContain("authentication");
	});

	test("filters by partial file path", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				files: ["src/api"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.title).toContain("API");
	});

	test("file filter matches both filesRead and filesModified", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				files: ["src/db.ts"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.title).toContain("database");
	});

	test("file filter with no matches returns empty", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				files: ["nonexistent/path.ts"],
			},
		);

		expect(results.length).toBe(0);
	});
});

// =============================================================================
// Combined Filters
// =============================================================================

describe("combined filters", () => {
	test("importance + concept filters (AND logic)", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 3,
				concepts: ["authentication"],
			},
		);

		for (const r of results) {
			expect(r.observation.importance).toBeGreaterThanOrEqual(3);
			const hasAuth = r.observation.concepts.some((c) =>
				c.toLowerCase().includes("authentication"),
			);
			expect(hasAuth).toBe(true);
		}
		expect(results.length).toBe(2);
	});

	test("importance + file filters (AND logic)", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 4,
				files: ["src/auth.ts"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.importance).toBeGreaterThanOrEqual(4);
	});

	test("all filters combined narrows to specific result", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 5,
				concepts: ["OAuth2"],
				files: ["src/auth.ts"],
			},
		);

		expect(results.length).toBe(1);
		expect(results[0].observation.title).toContain("High importance authentication");
	});

	test("strict combined filters return empty set", async () => {
		seedFilterData();

		const results = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				importanceMin: 5,
				concepts: ["database"],
			},
		);

		expect(results.length).toBe(0);
	});
});

// =============================================================================
// No Filters Baseline
// =============================================================================

describe("no filters baseline", () => {
	test("no filters returns all matching observations", async () => {
		seedFilterData();

		const unfilteredResults = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
			},
		);

		expect(unfilteredResults.length).toBe(4);
	});

	test("no filters identical to explicit empty filter values", async () => {
		seedFilterData();

		const noFilters = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
			},
		);

		const emptyFilters = await orchestrator.search(
			"authentication OR database OR API OR testing",
			{
				strategy: "filter-only",
				projectPath: "/project/filters",
				concepts: undefined,
				files: undefined,
				importanceMin: undefined,
				importanceMax: undefined,
				createdAfter: undefined,
				createdBefore: undefined,
			},
		);

		expect(noFilters.length).toBe(emptyFilters.length);
		const noFilterIds = noFilters.map((r) => r.observation.id).sort();
		const emptyFilterIds = emptyFilters.map((r) => r.observation.id).sort();
		expect(noFilterIds).toEqual(emptyFilterIds);
	});
});

// =============================================================================
// Direct observations.search() Filter Tests
// =============================================================================

describe("observations.search() advanced filters", () => {
	test("importanceMin in direct search", () => {
		seedFilterData();

		const results = observations.search({
			query: "authentication OR database OR API OR testing",
			projectPath: "/project/filters",
			importanceMin: 4,
		});

		for (const r of results) {
			expect(r.observation.importance).toBeGreaterThanOrEqual(4);
		}
	});

	test("importanceMax in direct search", () => {
		seedFilterData();

		const results = observations.search({
			query: "authentication OR database OR API OR testing",
			projectPath: "/project/filters",
			importanceMax: 2,
		});

		for (const r of results) {
			expect(r.observation.importance).toBeLessThanOrEqual(2);
		}
	});

	test("concepts filter in direct search", () => {
		seedFilterData();

		const results = observations.search({
			query: "authentication OR database OR API OR testing",
			projectPath: "/project/filters",
			concepts: ["OAuth2"],
		});

		expect(results.length).toBe(1);
		expect(results[0].observation.concepts).toContain("OAuth2");
	});

	test("files filter in direct search", () => {
		seedFilterData();

		const results = observations.search({
			query: "authentication OR database OR API OR testing",
			projectPath: "/project/filters",
			files: ["src/api/routes.ts"],
		});

		expect(results.length).toBe(1);
		expect(results[0].observation.filesModified).toContain("src/api/routes.ts");
	});
});
