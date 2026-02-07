import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { EntityRepository } from "../../src/db/entities";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { cleanupTestDb, createTestDb } from "./helpers";

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

function createObservation(title = "Test observation") {
	return obsRepo.create({
		sessionId: "sess-1",
		type: "discovery",
		title,
		subtitle: "",
		facts: [],
		narrative: "test",
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

describe("EntityRepository", () => {
	describe("upsertEntity", () => {
		test("creates new entity", () => {
			const entity = entityRepo.upsertEntity("React", "library");
			expect(entity.id).toBeDefined();
			expect(entity.name).toBe("React");
			expect(entity.entityType).toBe("library");
			expect(entity.mentionCount).toBe(1);
			expect(entity.firstSeenAt).toBeDefined();
			expect(entity.lastSeenAt).toBeDefined();
		});

		test("increments mention_count on duplicate", () => {
			entityRepo.upsertEntity("React", "library");
			const updated = entityRepo.upsertEntity("React", "library");
			expect(updated.mentionCount).toBe(2);
			expect(updated.name).toBe("React");
		});

		test("same name different type creates separate entities", () => {
			const lib = entityRepo.upsertEntity("React", "library");
			const concept = entityRepo.upsertEntity("React", "concept");
			expect(lib.id).not.toBe(concept.id);
			expect(lib.mentionCount).toBe(1);
			expect(concept.mentionCount).toBe(1);
		});
	});

	describe("createRelation", () => {
		test("creates relation with valid entities", () => {
			const obs = createObservation();
			const react = entityRepo.upsertEntity("React", "library");
			const nextjs = entityRepo.upsertEntity("Next.js", "library");

			const rel = entityRepo.createRelation(react.id, nextjs.id, "uses", obs.id);
			expect(rel).not.toBeNull();
			expect(rel!.sourceEntityId).toBe(react.id);
			expect(rel!.targetEntityId).toBe(nextjs.id);
			expect(rel!.relationship).toBe("uses");
			expect(rel!.observationId).toBe(obs.id);
		});

		test("ignores duplicate relations", () => {
			const obs = createObservation();
			const react = entityRepo.upsertEntity("React", "library");
			const nextjs = entityRepo.upsertEntity("Next.js", "library");

			const rel1 = entityRepo.createRelation(react.id, nextjs.id, "uses", obs.id);
			const rel2 = entityRepo.createRelation(react.id, nextjs.id, "uses", obs.id);
			expect(rel1).not.toBeNull();
			expect(rel2).not.toBeNull();
			expect(rel1!.id).toBe(rel2!.id);
		});
	});

	describe("linkObservation", () => {
		test("links entity to observation", () => {
			const obs = createObservation();
			const entity = entityRepo.upsertEntity("React", "library");

			entityRepo.linkObservation(entity.id, obs.id);
			const obsIds = entityRepo.getObservationsForEntity(entity.id);
			expect(obsIds).toContain(obs.id);
		});

		test("ignores duplicate links", () => {
			const obs = createObservation();
			const entity = entityRepo.upsertEntity("React", "library");

			entityRepo.linkObservation(entity.id, obs.id);
			entityRepo.linkObservation(entity.id, obs.id);
			const obsIds = entityRepo.getObservationsForEntity(entity.id);
			expect(obsIds).toHaveLength(1);
		});
	});

	describe("findByName", () => {
		test("finds entities via FTS5", () => {
			entityRepo.upsertEntity("React", "library");
			entityRepo.upsertEntity("React Native", "library");
			entityRepo.upsertEntity("Vue", "library");

			const results = entityRepo.findByName("React");
			expect(results.length).toBeGreaterThanOrEqual(1);
			expect(results.some((e) => e.name === "React")).toBe(true);
		});

		test("returns empty for no match", () => {
			entityRepo.upsertEntity("React", "library");
			const results = entityRepo.findByName("nonexistent_xyz_abc");
			expect(results).toHaveLength(0);
		});
	});

	describe("getRelationsFor", () => {
		test("returns relations where entity is source or target", () => {
			const obs = createObservation();
			const react = entityRepo.upsertEntity("React", "library");
			const nextjs = entityRepo.upsertEntity("Next.js", "library");
			const typescript = entityRepo.upsertEntity("TypeScript", "technology");

			entityRepo.createRelation(react.id, nextjs.id, "uses", obs.id);
			entityRepo.createRelation(typescript.id, react.id, "related_to", obs.id);

			const relations = entityRepo.getRelationsFor(react.id);
			expect(relations).toHaveLength(2);
		});

		test("returns empty for entity with no relations", () => {
			entityRepo.upsertEntity("Lonely", "concept");
			const lonely = entityRepo.findByName("Lonely")[0];
			const relations = entityRepo.getRelationsFor(lonely.id);
			expect(relations).toHaveLength(0);
		});
	});

	describe("traverseRelations", () => {
		test("BFS with depth 1 finds direct neighbors", () => {
			const obs = createObservation();
			const a = entityRepo.upsertEntity("A", "concept");
			const b = entityRepo.upsertEntity("B", "concept");
			const c = entityRepo.upsertEntity("C", "concept");

			entityRepo.createRelation(a.id, b.id, "related_to", obs.id);
			entityRepo.createRelation(b.id, c.id, "related_to", obs.id);

			const visited = entityRepo.traverseRelations(a.id, 1);
			expect(visited.has(a.id)).toBe(true);
			expect(visited.has(b.id)).toBe(true);
			expect(visited.has(c.id)).toBe(false);
		});

		test("BFS with depth 2 finds two-hop neighbors", () => {
			const obs = createObservation();
			const a = entityRepo.upsertEntity("A", "concept");
			const b = entityRepo.upsertEntity("B", "concept");
			const c = entityRepo.upsertEntity("C", "concept");
			const d = entityRepo.upsertEntity("D", "concept");

			entityRepo.createRelation(a.id, b.id, "related_to", obs.id);
			entityRepo.createRelation(b.id, c.id, "related_to", obs.id);
			entityRepo.createRelation(c.id, d.id, "related_to", obs.id);

			const visited = entityRepo.traverseRelations(a.id, 2);
			expect(visited.has(a.id)).toBe(true);
			expect(visited.has(b.id)).toBe(true);
			expect(visited.has(c.id)).toBe(true);
			expect(visited.has(d.id)).toBe(false);
		});

		test("handles cycles (A→B→A)", () => {
			const obs = createObservation();
			const a = entityRepo.upsertEntity("CycleA", "concept");
			const b = entityRepo.upsertEntity("CycleB", "concept");

			entityRepo.createRelation(a.id, b.id, "related_to", obs.id);

			const visited = entityRepo.traverseRelations(a.id, 2);
			expect(visited.has(a.id)).toBe(true);
			expect(visited.has(b.id)).toBe(true);
			expect(visited.size).toBe(2);
		});

		test("caps depth at 2 even if higher requested", () => {
			const obs = createObservation();
			const a = entityRepo.upsertEntity("Deep1", "concept");
			const b = entityRepo.upsertEntity("Deep2", "concept");
			const c = entityRepo.upsertEntity("Deep3", "concept");
			const d = entityRepo.upsertEntity("Deep4", "concept");

			entityRepo.createRelation(a.id, b.id, "related_to", obs.id);
			entityRepo.createRelation(b.id, c.id, "related_to", obs.id);
			entityRepo.createRelation(c.id, d.id, "related_to", obs.id);

			const visited = entityRepo.traverseRelations(a.id, 10);
			expect(visited.has(d.id)).toBe(false);
		});
	});

	describe("getObservationsForEntity", () => {
		test("returns linked observation IDs", () => {
			const obs1 = createObservation("Obs 1");
			const obs2 = createObservation("Obs 2");
			const entity = entityRepo.upsertEntity("React", "library");

			entityRepo.linkObservation(entity.id, obs1.id);
			entityRepo.linkObservation(entity.id, obs2.id);

			const obsIds = entityRepo.getObservationsForEntity(entity.id);
			expect(obsIds).toHaveLength(2);
			expect(obsIds).toContain(obs1.id);
			expect(obsIds).toContain(obs2.id);
		});

		test("returns empty for entity with no observations", () => {
			const entity = entityRepo.upsertEntity("Orphan", "concept");
			const obsIds = entityRepo.getObservationsForEntity(entity.id);
			expect(obsIds).toHaveLength(0);
		});
	});

	describe("getById", () => {
		test("returns entity by id", () => {
			const created = entityRepo.upsertEntity("React", "library");
			const found = entityRepo.getById(created.id);
			expect(found).not.toBeNull();
			expect(found!.name).toBe("React");
		});

		test("returns null for missing id", () => {
			expect(entityRepo.getById("nonexistent")).toBeNull();
		});
	});
});
