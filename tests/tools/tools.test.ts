// =============================================================================
// open-mem — Custom Tools Tests (Task 17)
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { createRecallTool } from "../../src/tools/recall";
import { createSaveTool } from "../../src/tools/save";
import { createSearchTool } from "../../src/tools/search";
import { createTimelineTool } from "../../src/tools/timeline";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let sessions: SessionRepository;
let observations: ObservationRepository;
let summaries: SummaryRepository;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	sessions = new SessionRepository(db);
	observations = new ObservationRepository(db);
	summaries = new SummaryRepository(db);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedData() {
	sessions.create("sess-1", "/tmp/proj");
	observations.create({
		sessionId: "sess-1",
		type: "discovery",
		title: "Found JWT authentication pattern",
		subtitle: "In auth module",
		facts: ["Uses RS256"],
		narrative: "The auth module uses JWT tokens.",
		concepts: ["JWT", "authentication"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		tokenCount: 50,
	});
	observations.create({
		sessionId: "sess-1",
		type: "decision",
		title: "Decided to use refresh tokens",
		subtitle: "",
		facts: ["Improves security"],
		narrative: "Decided to add refresh token support.",
		concepts: ["JWT", "security"],
		filesRead: [],
		filesModified: ["src/auth.ts"],
		rawToolOutput: "raw",
		toolName: "Edit",
		tokenCount: 40,
	});
	summaries.create({
		sessionId: "sess-1",
		summary: "Explored and improved JWT auth.",
		keyDecisions: ["Use refresh tokens"],
		filesModified: ["src/auth.ts"],
		concepts: ["JWT"],
		tokenCount: 20,
	});
}

const abort = new AbortController().signal;

// =============================================================================
// mem-search
// =============================================================================

describe("mem-search", () => {
	test("returns formatted results", async () => {
		seedData();
		const tool = createSearchTool(new SearchOrchestrator(observations, null, false), summaries);
		const result = await tool.execute({ query: "JWT", limit: 10 }, { sessionID: "s", abort });
		expect(typeof result).toBe("string");
		expect(result).toContain("Found");
		expect(result).toContain("JWT authentication pattern");
	});

	test("filters by type", async () => {
		seedData();
		const tool = createSearchTool(new SearchOrchestrator(observations, null, false), summaries);
		const result = await tool.execute(
			{ query: "JWT", type: "decision", limit: 10 },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("refresh tokens");
		expect(result).not.toContain("DISCOVERY");
	});

	test("returns no-results message", async () => {
		const tool = createSearchTool(new SearchOrchestrator(observations, null, false), summaries);
		const result = await tool.execute(
			{ query: "xyznonexistent", limit: 10 },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("No matching");
	});

	test("falls back to summary search", async () => {
		sessions.create("sess-1", "/tmp/proj");
		summaries.create({
			sessionId: "sess-1",
			summary: "Worked on GraphQL API integration.",
			keyDecisions: [],
			filesModified: [],
			concepts: ["GraphQL"],
			tokenCount: 10,
		});
		const tool = createSearchTool(new SearchOrchestrator(observations, null, false), summaries);
		const result = await tool.execute({ query: "GraphQL", limit: 10 }, { sessionID: "s", abort });
		expect(result).toContain("session summary");
		expect(result).toContain("GraphQL");
	});
});

// =============================================================================
// mem-save
// =============================================================================

describe("mem-save", () => {
	test("creates observation and returns confirmation", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj");
		const result = await tool.execute(
			{
				title: "Important decision",
				type: "decision",
				narrative: "We decided to use PostgreSQL",
			},
			{ sessionID: "sess-1", abort },
		);
		expect(typeof result).toBe("string");
		expect(result).toContain("Saved observation");
		expect(result).toContain("Important decision");
		expect(observations.getCount("sess-1")).toBe(1);
	});

	test("handles concepts and files", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj");
		await tool.execute(
			{
				title: "DB migration",
				type: "change",
				narrative: "Migrated to Postgres",
				concepts: ["database", "postgres"],
				files: ["src/db.ts"],
			},
			{ sessionID: "sess-1", abort },
		);
		const obs = observations.getBySession("sess-1");
		expect(obs[0].concepts).toEqual(["database", "postgres"]);
		expect(obs[0].filesModified).toEqual(["src/db.ts"]);
	});

	test("increments session observation count", async () => {
		sessions.create("sess-1", "/tmp/proj");
		const tool = createSaveTool(observations, sessions, "/tmp/proj");
		await tool.execute(
			{
				title: "Note",
				type: "discovery",
				narrative: "Something important",
			},
			{ sessionID: "sess-1", abort },
		);
		const session = sessions.getById("sess-1");
		expect(session?.observationCount).toBe(1);
	});
});

// =============================================================================
// mem-timeline
// =============================================================================

describe("mem-timeline", () => {
	test("shows recent sessions", async () => {
		seedData();
		const tool = createTimelineTool(sessions, summaries, observations, "/tmp/proj");
		const result = await tool.execute({ limit: 5 }, { sessionID: "s", abort });
		expect(typeof result).toBe("string");
		expect(result).toContain("Session Timeline");
		expect(result).toContain("sess-1");
	});

	test("shows session detail", async () => {
		seedData();
		const tool = createTimelineTool(sessions, summaries, observations, "/tmp/proj");
		const result = await tool.execute({ sessionId: "sess-1" }, { sessionID: "s", abort });
		expect(result).toContain("Session Detail");
		expect(result).toContain("JWT authentication pattern");
	});

	test("returns empty message when no sessions", async () => {
		const tool = createTimelineTool(sessions, summaries, observations, "/tmp/proj");
		const result = await tool.execute({ limit: 5 }, { sessionID: "s", abort });
		expect(result).toContain("No past sessions");
	});
});

// =============================================================================
// mem-recall
// =============================================================================

describe("mem-recall", () => {
	test("returns full details for valid ID", async () => {
		seedData();
		const allObs = observations.getBySession("sess-1");
		const targetId = allObs[0].id;

		const tool = createRecallTool(observations);
		const result = await tool.execute({ ids: [targetId] }, { sessionID: "s", abort });
		expect(result).toContain("Recalled 1 observation(s)");
		expect(result).toContain("JWT authentication pattern");
		expect(result).toContain("The auth module uses JWT tokens.");
		expect(result).toContain("Uses RS256");
		expect(result).toContain("JWT, authentication");
		expect(result).toContain("src/auth.ts");
	});

	test("handles invalid ID", async () => {
		const tool = createRecallTool(observations);
		const result = await tool.execute({ ids: ["nonexistent-id"] }, { sessionID: "s", abort });
		expect(result).toContain("nonexistent-id");
		expect(result).toContain("Not found");
	});

	test("handles multiple IDs", async () => {
		seedData();
		const allObs = observations.getBySession("sess-1");
		const id1 = allObs[0].id;
		const id2 = allObs[1].id;

		const tool = createRecallTool(observations);
		const result = await tool.execute({ ids: [id1, id2] }, { sessionID: "s", abort });
		expect(result).toContain("Recalled 2 observation(s)");
		expect(result).toContain("JWT authentication pattern");
		expect(result).toContain("Decided to use refresh tokens");
	});
});

// =============================================================================
// Contract checks
// =============================================================================

describe("Tool contract", () => {
	test("all tools have required fields", () => {
		const search = createSearchTool(new SearchOrchestrator(observations, null, false), summaries);
		const save = createSaveTool(observations, sessions, "/tmp");
		const timeline = createTimelineTool(sessions, summaries, observations, "/tmp");
		const recall = createRecallTool(observations);

		for (const tool of [search, save, timeline, recall]) {
			expect(typeof tool.name).toBe("string");
			expect(typeof tool.description).toBe("string");
			expect(typeof tool.args).toBe("object");
			expect(typeof tool.execute).toBe("function");
		}
	});
});
