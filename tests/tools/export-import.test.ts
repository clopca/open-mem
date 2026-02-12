// =============================================================================
// open-mem — Export/Import Tool Tests
// =============================================================================

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { createExportTool } from "../../src/tools/export";
import { createImportTool } from "../../src/tools/import";
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

const abort = new AbortController().signal;

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
		rawToolOutput: "raw tool output here",
		toolName: "Read",
		tokenCount: 50,
		discoveryTokens: 0,
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
		rawToolOutput: "raw decision output",
		toolName: "Edit",
		tokenCount: 40,
		discoveryTokens: 0,
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

// =============================================================================
// mem-export
// =============================================================================

describe("mem-export", () => {
	test("produces valid JSON with version marker", async () => {
		seedData();
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute({ format: "json" }, { sessionID: "s", abort });

		expect(result).toContain("Exported");
		const jsonStr = result.substring(result.indexOf("{"));
		const parsed = JSON.parse(jsonStr);
		expect(parsed.version).toBe(1);
		expect(parsed.exportedAt).toBeDefined();
		expect(parsed.project).toBe("/tmp/proj");
	});

	test("includes observations and summaries", async () => {
		seedData();
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute({ format: "json" }, { sessionID: "s", abort });

		const jsonStr = result.substring(result.indexOf("{"));
		const parsed = JSON.parse(jsonStr);
		expect(parsed.observations).toHaveLength(2);
		expect(parsed.summaries).toHaveLength(1);
		expect(parsed.observations[0].title).toBeDefined();
		expect(parsed.summaries[0].summary).toContain("JWT");
	});

	test("strips rawToolOutput from observations", async () => {
		seedData();
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute({ format: "json" }, { sessionID: "s", abort });

		const jsonStr = result.substring(result.indexOf("{"));
		const parsed = JSON.parse(jsonStr);
		for (const obs of parsed.observations) {
			expect(obs.rawToolOutput).toBeUndefined();
		}
	});

	test("returns message when no sessions exist", async () => {
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute({ format: "json" }, { sessionID: "s", abort });
		expect(result).toContain("No sessions found");
	});

	test("filters by type", async () => {
		seedData();
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute(
			{ format: "json", type: "decision" },
			{ sessionID: "s", abort },
		);

		const jsonStr = result.substring(result.indexOf("{"));
		const parsed = JSON.parse(jsonStr);
		expect(parsed.observations).toHaveLength(1);
		expect(parsed.observations[0].type).toBe("decision");
	});

	test("respects limit", async () => {
		seedData();
		const tool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await tool.execute({ format: "json", limit: 1 }, { sessionID: "s", abort });

		const jsonStr = result.substring(result.indexOf("{"));
		const parsed = JSON.parse(jsonStr);
		expect(parsed.observations).toHaveLength(1);
	});
});

// =============================================================================
// mem-import
// =============================================================================

describe("mem-import", () => {
	test("creates observations from exported JSON", async () => {
		seedData();
		const exportTool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const exportResult = await exportTool.execute({ format: "json" }, { sessionID: "s", abort });
		const jsonStr = exportResult.substring(exportResult.indexOf("{"));

		const result2 = createTestDb();
		const db2 = result2.db;
		const sessions2 = new SessionRepository(db2);
		const observations2 = new ObservationRepository(db2);
		const summaries2 = new SummaryRepository(db2);

		try {
			const importTool = createImportTool(observations2, summaries2, sessions2, "/tmp/proj2");
			const importResult = await importTool.execute({ data: jsonStr }, { sessionID: "s", abort });

			expect(importResult).toContain("Imported 2 observation(s)");
			expect(importResult).toContain("1 summary(ies)");
			expect(observations2.getCount()).toBe(2);
		} finally {
			db2.close();
			cleanupTestDb(result2.dbPath);
		}
	});

	test("skips duplicate observations by ID", async () => {
		seedData();
		const exportTool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const exportResult = await exportTool.execute({ format: "json" }, { sessionID: "s", abort });
		const jsonStr = exportResult.substring(exportResult.indexOf("{"));

		const parsed = JSON.parse(jsonStr);
		const existingObs = observations.getBySession("sess-1");
		parsed.observations = parsed.observations.map((obs: Record<string, unknown>, i: number) => ({
			...obs,
			id: existingObs[i]?.id ?? obs.id,
		}));

		const importTool = createImportTool(observations, summaries, sessions, "/tmp/proj");
		const importResult = await importTool.execute(
			{ data: JSON.stringify(parsed) },
			{ sessionID: "s", abort },
		);

		expect(importResult).toContain("Skipped 2 duplicate observation(s)");
	});

	test("handles invalid JSON gracefully", async () => {
		const importTool = createImportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await importTool.execute(
			{ data: "not valid json{{{" },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("Invalid JSON");
	});

	test("validates version field", async () => {
		const importTool = createImportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await importTool.execute(
			{ data: JSON.stringify({ observations: [] }) },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("Missing or invalid 'version'");
	});

	test("rejects unsupported version", async () => {
		const importTool = createImportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await importTool.execute(
			{ data: JSON.stringify({ version: 99, observations: [] }) },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("Unsupported export version");
	});

	test("validates observations array", async () => {
		const importTool = createImportTool(observations, summaries, sessions, "/tmp/proj");
		const result = await importTool.execute(
			{ data: JSON.stringify({ version: 1, observations: "not-array" }) },
			{ sessionID: "s", abort },
		);
		expect(result).toContain("Missing or invalid 'observations' array");
	});
});

// =============================================================================
// Round-trip
// =============================================================================

describe("export → import round-trip", () => {
	test("data matches after round-trip", async () => {
		seedData();
		const exportTool = createExportTool(observations, summaries, sessions, "/tmp/proj");
		const exportResult = await exportTool.execute({ format: "json" }, { sessionID: "s", abort });
		const jsonStr = exportResult.substring(exportResult.indexOf("{"));

		const result2 = createTestDb();
		const db2 = result2.db;
		const sessions2 = new SessionRepository(db2);
		const observations2 = new ObservationRepository(db2);
		const summaries2 = new SummaryRepository(db2);

		try {
			const importTool = createImportTool(observations2, summaries2, sessions2, "/tmp/proj2");
			await importTool.execute({ data: jsonStr }, { sessionID: "s", abort });

			const originalObs = observations.getBySession("sess-1");
			const importedSessions = sessions2.getAll("/tmp/proj2");
			expect(importedSessions.length).toBeGreaterThan(0);

			const importedObs: ReturnType<typeof observations2.getBySession> = [];
			for (const sess of importedSessions) {
				importedObs.push(...observations2.getBySession(sess.id));
			}

			expect(importedObs).toHaveLength(originalObs.length);
			expect(importedObs[0].title).toBe(originalObs[0].title);
			expect(importedObs[0].narrative).toBe(originalObs[0].narrative);
			expect(importedObs[0].concepts).toEqual(originalObs[0].concepts);
			expect(importedObs[0].type).toBe(originalObs[0].type);
		} finally {
			db2.close();
			cleanupTestDb(result2.dbPath);
		}
	});
});
