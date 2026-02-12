// =============================================================================
// open-mem — User-Level Memory Tools Tests (Task 6)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { UserMemoryDatabase, UserObservationRepository } from "../../src/db/user-memory";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { createRecallTool } from "../../src/tools/recall";
import { createSaveTool } from "../../src/tools/save";
import { createSearchTool } from "../../src/tools/search";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let sessions: SessionRepository;
let observations: ObservationRepository;
let summaries: SummaryRepository;

let userMemoryDb: UserMemoryDatabase;
let userDbPath: string;
let userObservationRepo: UserObservationRepository;

const abort = new AbortController().signal;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	sessions = new SessionRepository(db);
	observations = new ObservationRepository(db);
	summaries = new SummaryRepository(db);

	userDbPath = `/tmp/open-mem-user-test-${randomUUID()}.db`;
	userMemoryDb = new UserMemoryDatabase(userDbPath);
	userObservationRepo = new UserObservationRepository(userMemoryDb.database);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
	userMemoryDb.close();
	for (const suffix of ["", "-wal", "-shm"]) {
		try {
			unlinkSync(userDbPath + suffix);
		} catch {}
	}
});

// =============================================================================
// mem-create with scope
// =============================================================================

describe("mem-create with scope", () => {
	test("scope defaults to project — saves to project DB", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj", userObservationRepo);
		const result = await tool.execute(
			{
				title: "Project decision",
				type: "decision",
				narrative: "We chose PostgreSQL for the project",
			},
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("Saved observation");
		expect(result).not.toContain("user-level");
		expect(observations.getCount("sess-1")).toBe(1);
	});

	test("scope: 'project' explicitly saves to project DB", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj", userObservationRepo);
		const result = await tool.execute(
			{
				title: "Explicit project save",
				type: "discovery",
				narrative: "Found a pattern",
				scope: "project",
			},
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("Saved observation");
		expect(result).not.toContain("user-level");
		expect(observations.getCount("sess-1")).toBe(1);
	});

	test("scope: 'user' saves to user-level DB", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj", userObservationRepo);
		const result = await tool.execute(
			{
				title: "Cross-project preference",
				type: "decision",
				narrative: "I prefer tabs over spaces",
				scope: "user",
			},
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("user-level observation");
		expect(result).toContain("Cross-project preference");
		expect(result).toContain("scope: user");
		expect(observations.getCount("sess-1")).toBe(0);

		const userResults = userObservationRepo.search({ query: "tabs spaces" });
		expect(userResults.length).toBe(1);
		expect(userResults[0].observation.title).toBe("Cross-project preference");
		expect(userResults[0].observation.sourceProject).toBe("/tmp/proj");
	});

	test("scope: 'user' without user repo returns error", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj");
		const result = await tool.execute(
			{
				title: "Should fail",
				type: "decision",
				narrative: "This should not work",
				scope: "user",
			},
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("not enabled");
	});
});

// =============================================================================
// mem-find with user memory
// =============================================================================

describe("mem-find with user memory", () => {
	test("returns results from both project and user DBs", async () => {
		sessions.create("sess-1", "/tmp/proj");
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Project-level TypeScript pattern",
			subtitle: "",
			facts: [],
			narrative: "Found a useful TypeScript pattern in the project.",
			concepts: ["TypeScript"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		userObservationRepo.create({
			type: "decision",
			title: "User-level TypeScript preference",
			subtitle: "",
			facts: [],
			narrative: "I always prefer strict TypeScript config.",
			concepts: ["TypeScript"],
			filesRead: [],
			filesModified: [],
			toolName: "mem-create",
			tokenCount: 40,
			importance: 4,
			sourceProject: "/other/project",
		});

		const orchestrator = new SearchOrchestrator(
			observations,
			null,
			false,
			null,
			userObservationRepo,
		);
		const tool = createSearchTool(orchestrator, summaries);
		const result = await tool.execute(
			{ query: "TypeScript", limit: 10 },
			{ sessionID: "s", abort },
		);

		expect(result).toContain("Project-level TypeScript pattern");
		expect(result).toContain("User-level TypeScript preference");
		expect(result).toContain("[USER]");
	});

	test("project results appear before user results", async () => {
		sessions.create("sess-1", "/tmp/proj");
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Project authentication pattern",
			subtitle: "",
			facts: [],
			narrative: "Found JWT authentication in the project.",
			concepts: ["auth"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		userObservationRepo.create({
			type: "decision",
			title: "User authentication preference",
			subtitle: "",
			facts: [],
			narrative: "I prefer OAuth2 for authentication.",
			concepts: ["auth"],
			filesRead: [],
			filesModified: [],
			toolName: "mem-create",
			tokenCount: 40,
			importance: 3,
			sourceProject: "/other/project",
		});

		const orchestrator = new SearchOrchestrator(
			observations,
			null,
			false,
			null,
			userObservationRepo,
		);
		const tool = createSearchTool(orchestrator, summaries);
		const result = await tool.execute(
			{ query: "authentication", limit: 10 },
			{ sessionID: "s", abort },
		);

		const projectIdx = result.indexOf("Project authentication pattern");
		const userIdx = result.indexOf("User authentication preference");
		expect(projectIdx).toBeGreaterThan(-1);
		expect(userIdx).toBeGreaterThan(-1);
		expect(projectIdx).toBeLessThan(userIdx);
	});

	test("search without user repo works normally", async () => {
		sessions.create("sess-1", "/tmp/proj");
		observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Solo project discovery",
			subtitle: "",
			facts: [],
			narrative: "Found something interesting.",
			concepts: ["testing"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		const orchestrator = new SearchOrchestrator(observations, null, false);
		const tool = createSearchTool(orchestrator, summaries);
		const result = await tool.execute(
			{ query: "interesting", limit: 10 },
			{ sessionID: "s", abort },
		);

		expect(result).toContain("Solo project discovery");
		expect(result).not.toContain("[USER]");
	});
});

// =============================================================================
// mem-get with user memory
// =============================================================================

describe("mem-get with user memory", () => {
	test("recalls observation from project DB", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const obs = observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Project recall test",
			subtitle: "",
			facts: ["fact1"],
			narrative: "Testing project recall.",
			concepts: ["testing"],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		const tool = createRecallTool(observations, userObservationRepo);
		const result = await tool.execute({ ids: [obs.id] }, { sessionID: "s", abort });
		expect(result).toContain("Project recall test");
		expect(result).not.toContain("[USER]");
	});

	test("recalls observation from user DB when not in project DB", async () => {
		const userObs = userObservationRepo.create({
			type: "decision",
			title: "User recall test",
			subtitle: "",
			facts: ["user-fact"],
			narrative: "Testing user recall.",
			concepts: ["testing"],
			filesRead: [],
			filesModified: [],
			toolName: "mem-create",
			tokenCount: 40,
			importance: 3,
			sourceProject: "/other/project",
		});

		const tool = createRecallTool(observations, userObservationRepo);
		const result = await tool.execute({ ids: [userObs.id] }, { sessionID: "s", abort });
		expect(result).toContain("User recall test");
		expect(result).toContain("[USER]");
	});

	test("prefers project DB over user DB for same ID", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const obs = observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "Project version",
			subtitle: "",
			facts: [],
			narrative: "This is the project version.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		const tool = createRecallTool(observations, userObservationRepo);
		const result = await tool.execute({ ids: [obs.id] }, { sessionID: "s", abort });
		expect(result).toContain("Project version");
		expect(result).not.toContain("[USER]");
	});

	test("recall without user repo falls back gracefully", async () => {
		const tool = createRecallTool(observations);
		const result = await tool.execute({ ids: ["nonexistent-id"] }, { sessionID: "s", abort });
		expect(result).toContain("Not found");
	});

	test("recalls from both DBs in single call", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const projectObs = observations.create({
			sessionId: "sess-1",
			type: "discovery",
			title: "From project",
			subtitle: "",
			facts: [],
			narrative: "Project observation.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 50,
		});

		const userObs = userObservationRepo.create({
			type: "decision",
			title: "From user",
			subtitle: "",
			facts: [],
			narrative: "User observation.",
			concepts: [],
			filesRead: [],
			filesModified: [],
			toolName: "mem-create",
			tokenCount: 40,
			importance: 3,
			sourceProject: "/other/project",
		});

		const tool = createRecallTool(observations, userObservationRepo);
		const result = await tool.execute(
			{ ids: [projectObs.id, userObs.id] },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("Recalled 2 observation(s)");
		expect(result).toContain("From project");
		expect(result).toContain("From user");
	});
});
