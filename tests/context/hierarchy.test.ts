// =============================================================================
// open-mem — Cross-Project Memory Hierarchy Tests (Task 8)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { getDefaultConfig } from "../../src/config";
import { buildUserContextSection } from "../../src/context/builder";
import {
	UserMemoryDatabase,
	UserObservationRepository,
	type UserObservation,
} from "../../src/db/user-memory";
import { createCompactionHook } from "../../src/hooks/compaction";
import { createContextInjectionHook } from "../../src/hooks/context-inject";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import type {
	ObservationIndex,
	OpenMemConfig,
	Session,
	SessionSummary,
} from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createUserTestDb(): { userDb: UserMemoryDatabase; dbPath: string } {
	const dbPath = `/tmp/open-mem-hierarchy-test-${randomUUID()}.db`;
	const userDb = new UserMemoryDatabase(dbPath);
	return { userDb, dbPath };
}

function cleanupUserTestDb(dbPath: string): void {
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(dbPath + suffix);
		} catch {
			// file may not exist
		}
	}
}

function makeUserObsData(
	overrides?: Partial<Omit<UserObservation, "id" | "createdAt">>,
): Omit<UserObservation, "id" | "createdAt"> {
	return {
		type: "discovery",
		title: "Cross-project pattern",
		subtitle: "Found in multiple projects",
		facts: ["Fact A"],
		narrative: "A cross-project observation.",
		concepts: ["cross-project"],
		filesRead: ["src/shared.ts"],
		filesModified: [],
		toolName: "Read",
		tokenCount: 50,
		importance: 3,
		sourceProject: "/tmp/project-a",
		...overrides,
	};
}

function makeConfig(overrides?: Partial<OpenMemConfig>): OpenMemConfig {
	return {
		...getDefaultConfig(),
		contextInjectionEnabled: true,
		maxContextTokens: 1000,
		maxIndexEntries: 20,
		...overrides,
	};
}

function makeSession(overrides?: Partial<Session>): Session {
	return {
		id: "sess-1",
		projectPath: "/tmp/proj",
		startedAt: "2026-01-01T00:00:00Z",
		endedAt: null,
		status: "active",
		observationCount: 3,
		summaryId: "sum-1",
		...overrides,
	};
}

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
	return {
		id: "sum-1",
		sessionId: "sess-1",
		summary: "Explored JWT auth patterns.",
		keyDecisions: ["Use RS256"],
		filesModified: ["src/auth.ts"],
		concepts: ["JWT"],
		createdAt: "2026-01-01T00:00:00Z",
		tokenCount: 20,
		...overrides,
	};
}

function makeIndexEntry(overrides?: Partial<ObservationIndex>): ObservationIndex {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		tokenCount: 5,
		discoveryTokens: 100,
		createdAt: "2026-01-01T00:00:00Z",
		importance: 3,
		...overrides,
	};
}

function makeMockRepos(data?: {
	sessions?: Session[];
	summaries?: SessionSummary[];
	index?: ObservationIndex[];
}) {
	return {
		observations: {
			getIndex: () => data?.index ?? [],
			getById: (_id: string) => null,
			search: ({ query, limit }: { query: string; limit?: number }) => [],
		},
		sessions: {
			getRecent: () => data?.sessions ?? [],
		},
		summaries: {
			getBySessionId: (id: string) =>
				data?.summaries?.find((s) => s.sessionId === id) ?? null,
		},
	};
}

// =============================================================================
// User DB Lifecycle Tests
// =============================================================================

describe("Memory Hierarchy — User DB lifecycle", () => {
	let userDb: UserMemoryDatabase;
	let dbPath: string;
	let repo: UserObservationRepository;

	beforeEach(() => {
		const result = createUserTestDb();
		userDb = result.userDb;
		dbPath = result.dbPath;
		repo = new UserObservationRepository(userDb.database);
	});

	afterEach(() => {
		userDb.close();
		cleanupUserTestDb(dbPath);
	});

	test("UserMemoryDatabase creates DB and schema correctly", () => {
		// WAL mode
		const walRow = userDb.database.get<{ journal_mode: string }>("PRAGMA journal_mode");
		expect(walRow?.journal_mode).toBe("wal");

		// user_observations table exists
		const tables = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='user_observations'",
		);
		expect(tables).toHaveLength(1);

		// FTS5 table exists
		const fts = userDb.database.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='user_observations_fts'",
		);
		expect(fts).toHaveLength(1);
	});

	test("User observations CRUD (create, read, search, delete)", () => {
		// Create
		const obs = repo.create(makeUserObsData({ title: "Hierarchy CRUD test" }));
		expect(obs.id).toBeDefined();
		expect(obs.title).toBe("Hierarchy CRUD test");

		// Read
		const fetched = repo.getById(obs.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.title).toBe("Hierarchy CRUD test");

		// Search
		const results = repo.search({ query: "Hierarchy CRUD" });
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].observation.id).toBe(obs.id);

		// Delete
		const deleted = repo.delete(obs.id);
		expect(deleted).toBe(true);
		expect(repo.getById(obs.id)).toBeNull();
	});

	test("source_project field correctly tracks origin", () => {
		repo.create(makeUserObsData({ sourceProject: "/project/alpha", title: "Alpha obs" }));
		repo.create(makeUserObsData({ sourceProject: "/project/beta", title: "Beta obs" }));
		repo.create(makeUserObsData({ sourceProject: "/project/alpha", title: "Alpha obs 2" }));

		const alphaIndex = repo.getIndex(20, "/project/alpha");
		expect(alphaIndex).toHaveLength(2);

		const betaIndex = repo.getIndex(20, "/project/beta");
		expect(betaIndex).toHaveLength(1);

		const allIndex = repo.getIndex();
		expect(allIndex).toHaveLength(3);
	});
});

// =============================================================================
// Search Merge Tests
// =============================================================================

describe("Memory Hierarchy — Search merge", () => {
	let userDb: UserMemoryDatabase;
	let dbPath: string;
	let userRepo: UserObservationRepository;

	beforeEach(() => {
		const result = createUserTestDb();
		userDb = result.userDb;
		dbPath = result.dbPath;
		userRepo = new UserObservationRepository(userDb.database);
	});

	afterEach(() => {
		userDb.close();
		cleanupUserTestDb(dbPath);
	});

	test("SearchOrchestrator returns results from both project and user DBs", async () => {
		// Seed user memory
		userRepo.create(makeUserObsData({ title: "User-level TypeScript pattern" }));

		// Mock project observations that return a result for FTS search
		const projectObs = {
			id: "proj-obs-1",
			sessionId: "s1",
			type: "discovery" as const,
			title: "Project-level TypeScript config",
			subtitle: "",
			facts: [],
			narrative: "",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			createdAt: "2026-01-01T00:00:00Z",
			tokenCount: 10,
			discoveryTokens: 50,
			importance: 3,
		};
		const mockProjectRepo = {
			search: () => [{ observation: projectObs, rank: -1, snippet: projectObs.title }],
			searchByConcept: () => [],
			searchByFile: () => [],
			getById: (id: string) => (id === projectObs.id ? projectObs : null),
			getWithEmbeddings: () => [],
			getVecEmbeddingMatches: () => [],
		};

		const orchestrator = new SearchOrchestrator(
			mockProjectRepo as never,
			null,
			false,
			null,
			userRepo,
		);

		const results = await orchestrator.search("TypeScript", {
			projectPath: "/tmp/proj",
			strategy: "filter-only",
		});

		// Should have results from both sources
		const projectResults = results.filter((r) => r.source === "project");
		const userResults = results.filter((r) => r.source === "user");
		expect(projectResults.length).toBeGreaterThanOrEqual(1);
		expect(userResults.length).toBeGreaterThanOrEqual(1);
	});

	test("Project results ranked higher than user results (appear first)", async () => {
		userRepo.create(makeUserObsData({ title: "User-level auth discovery" }));

		const projectObs = {
			id: "proj-1",
			sessionId: "s1",
			type: "discovery" as const,
			title: "Project auth config",
			subtitle: "",
			facts: [],
			narrative: "",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			createdAt: "2026-01-01T00:00:00Z",
			tokenCount: 10,
			discoveryTokens: 50,
			importance: 3,
		};
		const mockProjectRepo = {
			search: () => [{ observation: projectObs, rank: -1, snippet: projectObs.title }],
			searchByConcept: () => [],
			searchByFile: () => [],
			getById: () => null,
			getWithEmbeddings: () => [],
			getVecEmbeddingMatches: () => [],
		};

		const orchestrator = new SearchOrchestrator(
			mockProjectRepo as never,
			null,
			false,
			null,
			userRepo,
		);

		const results = await orchestrator.search("auth", {
			projectPath: "/tmp/proj",
			strategy: "filter-only",
		});

		// Project results come before user results
		const firstProjectIdx = results.findIndex((r) => r.source === "project");
		const firstUserIdx = results.findIndex((r) => r.source === "user");
		expect(firstProjectIdx).toBeLessThan(firstUserIdx);
	});

	test("Results labeled with source ('project' or 'user')", async () => {
		userRepo.create(makeUserObsData({ title: "User labeled result" }));

		const projectObs = {
			id: "proj-1",
			sessionId: "s1",
			type: "discovery" as const,
			title: "Project labeled result",
			subtitle: "",
			facts: [],
			narrative: "",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			createdAt: "2026-01-01T00:00:00Z",
			tokenCount: 10,
			discoveryTokens: 50,
			importance: 3,
		};
		const mockProjectRepo = {
			search: () => [{ observation: projectObs, rank: -1, snippet: projectObs.title }],
			searchByConcept: () => [],
			searchByFile: () => [],
			getById: () => null,
			getWithEmbeddings: () => [],
			getVecEmbeddingMatches: () => [],
		};

		const orchestrator = new SearchOrchestrator(
			mockProjectRepo as never,
			null,
			false,
			null,
			userRepo,
		);

		const results = await orchestrator.search("labeled result", {
			projectPath: "/tmp/proj",
			strategy: "filter-only",
		});

		for (const r of results) {
			expect(r.source === "project" || r.source === "user").toBe(true);
		}
	});

	test("User memory disabled → only project results", async () => {
		// Orchestrator with no user repo
		const projectObs = {
			id: "proj-1",
			sessionId: "s1",
			type: "discovery" as const,
			title: "Project only result",
			subtitle: "",
			facts: [],
			narrative: "",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "",
			toolName: "Read",
			createdAt: "2026-01-01T00:00:00Z",
			tokenCount: 10,
			discoveryTokens: 50,
			importance: 3,
		};
		const mockProjectRepo = {
			search: () => [{ observation: projectObs, rank: -1, snippet: projectObs.title }],
			searchByConcept: () => [],
			searchByFile: () => [],
			getById: () => null,
			getWithEmbeddings: () => [],
			getVecEmbeddingMatches: () => [],
		};

		const orchestrator = new SearchOrchestrator(
			mockProjectRepo as never,
			null,
			false,
			null,
			null, // no user repo
		);

		const results = await orchestrator.search("Project", {
			projectPath: "/tmp/proj",
			strategy: "filter-only",
		});

		expect(results.every((r) => r.source === "project")).toBe(true);
		expect(results.some((r) => r.source === "user")).toBe(false);
	});
});

// =============================================================================
// Context Injection Tests
// =============================================================================

describe("Memory Hierarchy — Context injection", () => {
	test("System prompt includes 'Cross-Project Memory' section when enabled", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "user-1", title: "User preference: dark mode", tokenCount: 10 }),
			],
		};
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: true, userMemoryMaxContextTokens: 500 }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "test-model" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).toContain("### Cross-Project Memory");
		expect(output.system[1]).toContain("User preference: dark mode");
	});

	test("User-level context respects its own token budget (userMemoryMaxContextTokens)", () => {
		const entries: ObservationIndex[] = [
			makeIndexEntry({ id: "u1", title: "First user obs", tokenCount: 8 }),
			makeIndexEntry({ id: "u2", title: "Second user obs", tokenCount: 8 }),
			makeIndexEntry({ id: "u3", title: "Third user obs", tokenCount: 8 }),
		];
		// Budget of 15 should only fit the first entry (8 < 15, 8+8=16 > 15)
		const result = buildUserContextSection(entries, 15);
		expect(result).toContain("u1");
		expect(result).not.toContain("u2");
		expect(result).not.toContain("u3");
	});

	test("Project context budget NOT affected by user context", async () => {
		// Large user index that would blow budget if counted against project
		const largeUserEntries = Array.from({ length: 50 }, (_, i) =>
			makeIndexEntry({ id: `user-${i}`, title: `User obs ${i}`, tokenCount: 100 }),
		);
		const userRepo = { getIndex: () => largeUserEntries };

		const projectIndex = [
			makeIndexEntry({ id: "proj-1", title: "Project obs", tokenCount: 5 }),
		];
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: projectIndex,
		});

		const hook = createContextInjectionHook(
			makeConfig({
				userMemoryEnabled: true,
				userMemoryMaxContextTokens: 200,
				maxContextTokens: 1000,
			}),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "test-model" }, output);

		// Project context should still be present
		expect(output.system[1]).toContain("## open-mem");
		expect(output.system[1]).toContain("Project obs");
		// User section should be present but limited
		expect(output.system[1]).toContain("### Cross-Project Memory");
	});

	test("userMemoryEnabled: false → no user section in system prompt", async () => {
		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "user-1", title: "Should not appear", tokenCount: 10 }),
			],
		};
		const hook = createContextInjectionHook(
			makeConfig({ userMemoryEnabled: false }),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "test-model" }, output);

		expect(output.system).toHaveLength(2);
		expect(output.system[1]).not.toContain("Cross-Project Memory");
		expect(output.system[1]).not.toContain("Should not appear");
	});
});

// =============================================================================
// Compaction Tests
// =============================================================================

describe("Memory Hierarchy — Compaction", () => {
	test("Compaction includes user-level context when enabled", async () => {
		const config = makeConfig({
			userMemoryEnabled: true,
			userMemoryMaxContextTokens: 500,
		});
		const repos = {
			observations: { getIndex: () => [makeIndexEntry()] },
			sessions: { getRecent: () => [makeSession()] },
			summaries: { getBySessionId: () => makeSummary() },
		};
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "u1", title: "Cross-project compaction fact", tokenCount: 5 }),
			],
		};
		const hook = createCompactionHook(
			config,
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		expect(output.context[0]).toContain("Cross-project observations");
		expect(output.context[0]).toContain("Cross-project compaction fact");
	});

	test("Compaction excludes user-level context when disabled", async () => {
		const config = makeConfig({ userMemoryEnabled: false });
		const repos = {
			observations: { getIndex: () => [makeIndexEntry()] },
			sessions: { getRecent: () => [makeSession()] },
			summaries: { getBySessionId: () => makeSummary() },
		};
		const userRepo = {
			getIndex: () => [
				makeIndexEntry({ id: "u1", title: "Should not appear in compaction", tokenCount: 5 }),
			],
		};
		const hook = createCompactionHook(
			config,
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { context: [] as string[] };
		await hook({ sessionID: "s1" }, output);

		expect(output.context).toHaveLength(1);
		expect(output.context[0]).not.toContain("Cross-project");
		expect(output.context[0]).not.toContain("Should not appear");
	});
});

// =============================================================================
// Concurrent Access Tests
// =============================================================================

describe("Memory Hierarchy — Concurrent access", () => {
	let dbPath: string;

	beforeEach(() => {
		dbPath = `/tmp/open-mem-hierarchy-concurrent-${randomUUID()}.db`;
	});

	afterEach(() => {
		cleanupUserTestDb(dbPath);
	});

	test("Two UserMemoryDatabase instances can read from same DB file simultaneously", () => {
		const db1 = new UserMemoryDatabase(dbPath);
		const repo1 = new UserObservationRepository(db1.database);

		// Seed data via first instance
		repo1.create(makeUserObsData({ title: "Shared observation" }));

		// Open second instance on same file
		const db2 = new UserMemoryDatabase(dbPath);
		const repo2 = new UserObservationRepository(db2.database);

		// Both should be able to read
		const index1 = repo1.getIndex();
		const index2 = repo2.getIndex();

		expect(index1).toHaveLength(1);
		expect(index2).toHaveLength(1);
		expect(index1[0].title).toBe("Shared observation");
		expect(index2[0].title).toBe("Shared observation");

		db1.close();
		db2.close();
	});

	test("Write from one instance, read from another (WAL mode allows this)", () => {
		const db1 = new UserMemoryDatabase(dbPath);
		const repo1 = new UserObservationRepository(db1.database);

		const db2 = new UserMemoryDatabase(dbPath);
		const repo2 = new UserObservationRepository(db2.database);

		// Write via instance 1
		const obs = repo1.create(makeUserObsData({ title: "Written by instance 1" }));

		// Read via instance 2
		const fetched = repo2.getById(obs.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.title).toBe("Written by instance 1");

		// Write more via instance 2
		repo2.create(makeUserObsData({ title: "Written by instance 2" }));

		// Read all via instance 1
		const allIndex = repo1.getIndex();
		expect(allIndex).toHaveLength(2);

		db1.close();
		db2.close();
	});
});

// =============================================================================
// Budget Isolation Tests
// =============================================================================

describe("Memory Hierarchy — Budget isolation", () => {
	test("Large user-level index doesn't affect project-level token count", () => {
		// Build user section with large index
		const largeUserIndex = Array.from({ length: 100 }, (_, i) =>
			makeIndexEntry({ id: `user-${i}`, title: `User obs ${i}`, tokenCount: 50 }),
		);

		// User section with budget of 200 tokens — should only include a few entries
		const userSection = buildUserContextSection(largeUserIndex, 200);

		// Count how many entries made it in (each has tokenCount=50, so ~4 entries)
		const entryCount = (userSection.match(/user-\d+/g) || []).length;
		expect(entryCount).toBeLessThanOrEqual(4);
		expect(entryCount).toBeGreaterThanOrEqual(1);

		// The user section should NOT contain all 100 entries
		expect(userSection).not.toContain("user-99");
	});

	test("userMemoryMaxContextTokens limits user section size", async () => {
		const userEntries = Array.from({ length: 20 }, (_, i) =>
			makeIndexEntry({ id: `u-${i}`, title: `User entry ${i}`, tokenCount: 10 }),
		);
		const userRepo = { getIndex: () => userEntries };

		const repos = makeMockRepos({
			sessions: [makeSession()],
			summaries: [makeSummary()],
			index: [makeIndexEntry()],
		});

		// Very small user budget: only 25 tokens → should fit ~2 entries (10 each)
		const hook = createContextInjectionHook(
			makeConfig({
				userMemoryEnabled: true,
				userMemoryMaxContextTokens: 25,
			}),
			repos.observations as never,
			repos.sessions as never,
			repos.summaries as never,
			"/tmp/proj",
			userRepo as never,
		);

		const output = { system: ["existing prompt"] };
		await hook({ model: "test-model" }, output);

		const contextStr = output.system[1];
		expect(contextStr).toContain("### Cross-Project Memory");

		// Should contain first 2 entries but not all 20
		expect(contextStr).toContain("u-0");
		expect(contextStr).toContain("u-1");
		expect(contextStr).not.toContain("u-10");
		expect(contextStr).not.toContain("u-19");
	});
});
