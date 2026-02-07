import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { EntityRepository } from "../../src/db/entities";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { graphAugmentedSearch } from "../../src/search/graph";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import type { Observation, SearchResult } from "../../src/types";
import { cleanupTestDb, createTestDb } from "../db/helpers";

// =============================================================================
// Test Fixtures
// =============================================================================

let db: Database;
let dbPath: string;
let entityRepo: EntityRepository;
let obsRepo: ObservationRepository;
let sessionRepo: SessionRepository;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	entityRepo = new EntityRepository(db);
	obsRepo = new ObservationRepository(db);
	sessionRepo = new SessionRepository(db);
	sessionRepo.create("sess-1", "/tmp/project");
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

function createObservation(title: string, narrative = "test narrative"): Observation {
	return obsRepo.create({
		sessionId: "sess-1",
		type: "discovery",
		title,
		subtitle: "",
		facts: [],
		narrative,
		concepts: [],
		filesRead: [],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 100,
		discoveryTokens: 0,
		importance: 3,
	});
}

function makeSearchResult(obs: Observation): SearchResult {
	return {
		observation: obs,
		rank: -1,
		snippet: obs.title,
		source: "project",
	};
}

// =============================================================================
// graphAugmentedSearch — Core Function Tests
// =============================================================================

describe("graphAugmentedSearch", () => {
	test("returns base results unchanged when no entities exist", async () => {
		const obs1 = createObservation("JWT authentication pattern");
		const obs2 = createObservation("React component refactoring");
		const baseResults = [makeSearchResult(obs1), makeSearchResult(obs2)];

		const results = await graphAugmentedSearch(
			"JWT authentication",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		expect(results).toHaveLength(2);
		expect(results[0].observation.id).toBe(obs1.id);
		expect(results[1].observation.id).toBe(obs2.id);
	});

	test("finds related observations via entity graph", async () => {
		// Create observations
		const obs1 = createObservation("React hooks pattern");
		const obs2 = createObservation("Next.js routing setup");
		const obs3 = createObservation("Unrelated database stuff");

		// Create entities and link them
		const react = entityRepo.upsertEntity("React", "library");
		const nextjs = entityRepo.upsertEntity("Next.js", "library");

		// Link observations to entities
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(nextjs.id, obs2.id);

		// Create relation: React -> Next.js
		entityRepo.createRelation(react.id, nextjs.id, "uses", obs1.id);

		// Base results only contain obs3
		const baseResults = [makeSearchResult(obs3)];

		// Search for "React" — should find obs1 (linked to React) and obs2 (linked to Next.js, related to React)
		const results = await graphAugmentedSearch(
			"React",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		expect(results.length).toBeGreaterThan(1);
		// Base result should still be there
		expect(results.some((r) => r.observation.id === obs3.id)).toBe(true);
		// Graph-discovered observations should be added
		const graphIds = results.map((r) => r.observation.id);
		expect(graphIds).toContain(obs1.id);
	});

	test("deduplicates when base and graph results share observations", async () => {
		const obs1 = createObservation("React hooks pattern");
		const obs2 = createObservation("Next.js routing setup");

		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(react.id, obs2.id);

		// obs1 is already in base results
		const baseResults = [makeSearchResult(obs1)];

		const results = await graphAugmentedSearch(
			"React",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		// obs1 should appear only once (from base), obs2 added from graph
		const obs1Count = results.filter((r) => r.observation.id === obs1.id).length;
		expect(obs1Count).toBe(1);
		expect(results.some((r) => r.observation.id === obs2.id)).toBe(true);
	});

	test("respects limit parameter", async () => {
		const obs1 = createObservation("React hooks");
		const obs2 = createObservation("React components");
		const obs3 = createObservation("React state");
		const obs4 = createObservation("React effects");

		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(react.id, obs2.id);
		entityRepo.linkObservation(react.id, obs3.id);
		entityRepo.linkObservation(react.id, obs4.id);

		const baseResults: SearchResult[] = [];

		const results = await graphAugmentedSearch(
			"React",
			baseResults,
			entityRepo,
			obsRepo,
			2,
		);

		expect(results.length).toBeLessThanOrEqual(2);
	});

	test("returns base results when entity has no relations", async () => {
		const obs1 = createObservation("React hooks pattern");
		const obs2 = createObservation("Standalone concept");

		// Create entity with no relations and no linked observations
		entityRepo.upsertEntity("Standalone", "concept");

		const baseResults = [makeSearchResult(obs1)];

		const results = await graphAugmentedSearch(
			"Standalone",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		// Should return base results since entity has no linked observations
		expect(results).toHaveLength(1);
		expect(results[0].observation.id).toBe(obs1.id);
	});

	test("returns base results for empty query", async () => {
		const obs1 = createObservation("React hooks");
		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs1.id);

		const baseResults = [makeSearchResult(obs1)];

		const results = await graphAugmentedSearch(
			"",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		expect(results).toHaveLength(1);
		expect(results[0].observation.id).toBe(obs1.id);
	});

	test("returns base results for whitespace-only query", async () => {
		const obs1 = createObservation("React hooks");
		const baseResults = [makeSearchResult(obs1)];

		const results = await graphAugmentedSearch(
			"   ",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		expect(results).toHaveLength(1);
	});

	test("skips superseded observations from graph results", async () => {
		const obs1 = createObservation("React old pattern");
		const obs2 = createObservation("React new pattern");

		// Supersede obs1 with obs2
		obsRepo.supersede(obs1.id, obs2.id);

		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(react.id, obs2.id);

		const baseResults: SearchResult[] = [];

		const results = await graphAugmentedSearch(
			"React",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		// obs1 should be excluded (superseded), obs2 should be included
		expect(results.some((r) => r.observation.id === obs1.id)).toBe(false);
		expect(results.some((r) => r.observation.id === obs2.id)).toBe(true);
	});

	test("graph results have rank 0 and source 'project'", async () => {
		const obs1 = createObservation("React hooks");

		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs1.id);

		const results = await graphAugmentedSearch(
			"React",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		expect(results.length).toBeGreaterThanOrEqual(1);
		for (const r of results) {
			expect(r.rank).toBe(0);
			expect(r.source).toBe("project");
		}
	});
});

// =============================================================================
// SearchOrchestrator — Graph Integration Tests
// =============================================================================

describe("SearchOrchestrator graph integration", () => {
	test("uses graph search when entityRepo is provided", async () => {
		const obs1 = createObservation("React hooks pattern");
		const obs2 = createObservation("Next.js routing");

		const react = entityRepo.upsertEntity("React", "library");
		const nextjs = entityRepo.upsertEntity("Next.js", "library");
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(nextjs.id, obs2.id);
		entityRepo.createRelation(react.id, nextjs.id, "uses", obs1.id);

		// Orchestrator WITH entityRepo
		const orchestrator = new SearchOrchestrator(
			obsRepo,
			null,
			false,
			null,
			null,
			entityRepo,
		);

		const results = await orchestrator.search("React", {
			strategy: "filter-only",
			projectPath: "/tmp/project",
		});

		// Should find React-related observations via graph traversal
		// The FTS5 search may find obs1 directly, and graph should add obs2
		const ids = results.map((r) => r.observation.id);
		expect(ids).toContain(obs1.id);
	});

	test("skips graph search when entityRepo is null", async () => {
		const obs1 = createObservation("React hooks pattern");
		const obs2 = createObservation("Next.js routing");

		const react = entityRepo.upsertEntity("React", "library");
		const nextjs = entityRepo.upsertEntity("Next.js", "library");
		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(nextjs.id, obs2.id);
		entityRepo.createRelation(react.id, nextjs.id, "uses", obs1.id);

		// Orchestrator WITHOUT entityRepo
		const orchestrator = new SearchOrchestrator(
			obsRepo,
			null,
			false,
			null,
			null,
			null,
		);

		const results = await orchestrator.search("React", {
			strategy: "filter-only",
			projectPath: "/tmp/project",
		});

		// Without graph search, only FTS5 results — obs2 (Next.js routing) won't appear
		// unless it matches the FTS5 query for "React"
		const ids = results.map((r) => r.observation.id);
		expect(ids).not.toContain(obs2.id);
	});

	test("graph results are labeled with source 'project'", async () => {
		const obs1 = createObservation("TypeScript compiler");

		const ts = entityRepo.upsertEntity("TypeScript", "technology");
		entityRepo.linkObservation(ts.id, obs1.id);

		const orchestrator = new SearchOrchestrator(
			obsRepo,
			null,
			false,
			null,
			null,
			entityRepo,
		);

		const results = await orchestrator.search("TypeScript", {
			strategy: "filter-only",
			projectPath: "/tmp/project",
		});

		for (const r of results) {
			expect(r.source).toBe("project");
		}
	});
});

// =============================================================================
// Traversal Edge Cases
// =============================================================================

describe("graph traversal edge cases", () => {
	test("depth > 1 finds indirect connections via graph", async () => {
		// A --uses--> B --uses--> C
		const obsA = createObservation("Entity A observation");
		const obsB = createObservation("Entity B observation");
		const obsC = createObservation("Entity C observation");

		const a = entityRepo.upsertEntity("EntityA", "technology");
		const b = entityRepo.upsertEntity("EntityB", "library");
		const c = entityRepo.upsertEntity("EntityC", "pattern");

		entityRepo.linkObservation(a.id, obsA.id);
		entityRepo.linkObservation(b.id, obsB.id);
		entityRepo.linkObservation(c.id, obsC.id);

		entityRepo.createRelation(a.id, b.id, "uses", obsA.id);
		entityRepo.createRelation(b.id, c.id, "uses", obsB.id);

		// traverseRelations with depth=1 from A should find A and B
		const depth1 = entityRepo.traverseRelations(a.id, 1);
		expect(depth1.has(a.id)).toBe(true);
		expect(depth1.has(b.id)).toBe(true);
		expect(depth1.has(c.id)).toBe(false);

		// traverseRelations with depth=2 from A should find A, B, and C
		const depth2 = entityRepo.traverseRelations(a.id, 2);
		expect(depth2.has(a.id)).toBe(true);
		expect(depth2.has(b.id)).toBe(true);
		expect(depth2.has(c.id)).toBe(true);
	});

	test("cycle detection: A→B→C→A does not infinite loop", async () => {
		const obsA = createObservation("Cycle node A");
		const obsB = createObservation("Cycle node B");
		const obsC = createObservation("Cycle node C");

		const a = entityRepo.upsertEntity("CycleNodeA", "concept");
		const b = entityRepo.upsertEntity("CycleNodeB", "concept");
		const c = entityRepo.upsertEntity("CycleNodeC", "concept");

		entityRepo.linkObservation(a.id, obsA.id);
		entityRepo.linkObservation(b.id, obsB.id);
		entityRepo.linkObservation(c.id, obsC.id);

		// Create cycle: A → B → C → A
		entityRepo.createRelation(a.id, b.id, "related_to", obsA.id);
		entityRepo.createRelation(b.id, c.id, "related_to", obsB.id);
		entityRepo.createRelation(c.id, a.id, "related_to", obsC.id);

		// Should complete without hanging, visiting all 3 nodes
		const visited = entityRepo.traverseRelations(a.id, 2);
		expect(visited.has(a.id)).toBe(true);
		expect(visited.has(b.id)).toBe(true);
		expect(visited.has(c.id)).toBe(true);
		expect(visited.size).toBe(3);
	});

	test("cycle in graph search does not cause infinite loop", async () => {
		const obsA = createObservation("Cycle search A");
		const obsB = createObservation("Cycle search B");

		const a = entityRepo.upsertEntity("CycleSearchA", "concept");
		const b = entityRepo.upsertEntity("CycleSearchB", "concept");

		entityRepo.linkObservation(a.id, obsA.id);
		entityRepo.linkObservation(b.id, obsB.id);

		// Bidirectional relation (effective cycle at depth 1)
		entityRepo.createRelation(a.id, b.id, "related_to", obsA.id);

		const results = await graphAugmentedSearch(
			"CycleSearchA",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		// Should complete and return results without hanging
		expect(results.length).toBeGreaterThanOrEqual(1);
	});
});

// =============================================================================
// Entity Extraction Pipeline Tests
// =============================================================================

describe("entity extraction pipeline", () => {
	test("end-to-end: entities stored in DB are discoverable via graph search", async () => {
		const obs1 = createObservation("React hooks best practices", "Using useState and useEffect");
		const obs2 = createObservation("Webpack bundler config", "Configuring Webpack for production");

		const react = entityRepo.upsertEntity("React", "library");
		const webpack = entityRepo.upsertEntity("Webpack", "technology");
		const hooks = entityRepo.upsertEntity("hooks", "pattern");

		entityRepo.linkObservation(react.id, obs1.id);
		entityRepo.linkObservation(hooks.id, obs1.id);
		entityRepo.linkObservation(webpack.id, obs2.id);

		entityRepo.createRelation(react.id, hooks.id, "uses", obs1.id);
		entityRepo.createRelation(webpack.id, react.id, "uses", obs2.id);

		// Search for "Webpack" — should find obs2 (linked to Webpack)
		// and potentially obs1 via Webpack → React → hooks
		const results = await graphAugmentedSearch(
			"Webpack",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		const resultIds = results.map((r) => r.observation.id);
		expect(resultIds).toContain(obs2.id);
	});

	test("entity extraction disabled: no entities created, graph search returns base results", async () => {
		// When entityExtractionEnabled is false, no entities are created
		// Graph search should just return base results
		const obs1 = createObservation("Some observation");
		const baseResults = [makeSearchResult(obs1)];

		// No entities in DB at all
		const results = await graphAugmentedSearch(
			"anything",
			baseResults,
			entityRepo,
			obsRepo,
			10,
		);

		expect(results).toHaveLength(1);
		expect(results[0].observation.id).toBe(obs1.id);
	});

	test("entity extraction failure: observation still exists and is searchable", async () => {
		// Simulate: observation was created but entity extraction failed
		// The observation should still be in the DB and searchable via FTS
		const obs = createObservation("Important discovery about caching");

		// No entities were created (extraction failed)
		// Observation should still be retrievable
		const retrieved = obsRepo.getById(obs.id);
		expect(retrieved).not.toBeNull();
		expect(retrieved!.title).toBe("Important discovery about caching");

		// FTS search should still find it
		const searchResults = obsRepo.search({
			query: "caching",
			projectPath: "/tmp/project",
		});
		expect(searchResults.length).toBeGreaterThanOrEqual(1);
		expect(searchResults[0].observation.id).toBe(obs.id);
	});

	test("mock LLM entity extraction → stored → graph search finds them", async () => {
		// Simulate the full pipeline with mock EntityExtractor output
		const obs = createObservation(
			"Implemented singleton pattern for database connection",
			"The database module uses a singleton pattern to manage connection pooling",
		);

		// Mock extraction result (what EntityExtractor.extract() would return)
		const mockExtraction = {
			entities: [
				{ name: "singleton", entityType: "pattern" as const },
				{ name: "database", entityType: "technology" as const },
				{ name: "connection pooling", entityType: "pattern" as const },
			],
			relations: [
				{ sourceName: "database", targetName: "singleton", relationship: "uses" as const },
				{ sourceName: "database", targetName: "connection pooling", relationship: "uses" as const },
			],
		};

		// Simulate QueueProcessor entity storage logic
		const entityMap = new Map<string, string>();
		for (const e of mockExtraction.entities) {
			const entity = entityRepo.upsertEntity(e.name, e.entityType);
			entityMap.set(e.name, entity.id);
			entityRepo.linkObservation(entity.id, obs.id);
		}
		for (const r of mockExtraction.relations) {
			const sourceId = entityMap.get(r.sourceName);
			const targetId = entityMap.get(r.targetName);
			if (sourceId && targetId) {
				entityRepo.createRelation(sourceId, targetId, r.relationship, obs.id);
			}
		}

		// Now graph search for "singleton" should find the observation
		const results = await graphAugmentedSearch(
			"singleton",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results.some((r) => r.observation.id === obs.id)).toBe(true);
	});
});

// =============================================================================
// Multi-word Query Entity Matching
// =============================================================================

describe("multi-word query entity matching", () => {
	test("matches bigram entity names from query", async () => {
		const obs = createObservation("Connection pooling setup");

		const entity = entityRepo.upsertEntity("connection pooling", "pattern");
		entityRepo.linkObservation(entity.id, obs.id);

		// Query "connection pooling" should generate bigram "connection pooling"
		const results = await graphAugmentedSearch(
			"connection pooling configuration",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		// The bigram "connection pooling" should match the entity
		expect(results.some((r) => r.observation.id === obs.id)).toBe(true);
	});

	test("single word queries still match entities", async () => {
		const obs = createObservation("React component patterns");

		const react = entityRepo.upsertEntity("React", "library");
		entityRepo.linkObservation(react.id, obs.id);

		const results = await graphAugmentedSearch(
			"React",
			[],
			entityRepo,
			obsRepo,
			10,
		);

		expect(results.some((r) => r.observation.id === obs.id)).toBe(true);
	});
});
