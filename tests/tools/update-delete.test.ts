import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { SessionRepository } from "../../src/db/sessions";
import { createDeleteTool } from "../../src/tools/delete";
import { createUpdateTool } from "../../src/tools/update";
import { cleanupTestDb, createTestDb } from "../db/helpers";

let db: Database;
let dbPath: string;
let sessions: SessionRepository;
let observations: ObservationRepository;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
	sessions = new SessionRepository(db);
	observations = new ObservationRepository(db);
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

const abort = new AbortController().signal;
const PROJECT_PATH = "/tmp/proj";

function seedObservation(sessionId = "sess-1") {
	sessions.create(sessionId, PROJECT_PATH);
	return observations.create({
		sessionId,
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
		discoveryTokens: 200,
		importance: 3,
	});
}

describe("mem-update", () => {
	test("updates observation title", async () => {
		const obs = seedObservation();
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute(
			{ id: obs.id, title: "Updated JWT pattern" },
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("Updated observation");
		expect(result).toContain("title");
		const fetched = observations.getById(obs.id);
		expect(fetched?.title).toBe("Updated JWT pattern");
	});

	test("updates multiple fields", async () => {
		const obs = seedObservation();
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute(
			{
				id: obs.id,
				title: "New title",
				narrative: "New narrative",
				type: "decision",
				importance: 5,
			},
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("Updated observation");
		const fetched = observations.getById(obs.id);
		expect(fetched?.title).toBe("New title");
		expect(fetched?.narrative).toBe("New narrative");
		expect(fetched?.type).toBe("decision");
		expect(fetched?.importance).toBe(5);
	});

	test("rejects nonexistent observation", async () => {
		sessions.create("sess-1", PROJECT_PATH);
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute(
			{ id: "nonexistent", title: "x" },
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("not found");
	});

	test("rejects observation from different project", async () => {
		sessions.create("other-sess", "/tmp/other-project");
		const otherObs = observations.create({
			sessionId: "other-sess",
			type: "discovery",
			title: "Other project obs",
			subtitle: "",
			facts: [],
			narrative: "From another project",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 10,
			discoveryTokens: 0,
			importance: 3,
		});
		sessions.create("sess-1", PROJECT_PATH);
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute(
			{ id: otherObs.id, title: "Hijacked" },
			{ sessionID: "sess-1", abort },
		);
		expect(result).toContain("not found");
		expect(observations.getById(otherObs.id)?.title).toBe("Other project obs");
	});

	test("rejects missing id", async () => {
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute({ title: "x" }, { sessionID: "sess-1", abort });
		expect(result).toContain("error");
	});

	test("has correct tool contract", () => {
		const tool = createUpdateTool(observations, sessions, PROJECT_PATH);
		expect(tool.name).toBe("mem-update");
		expect(typeof tool.description).toBe("string");
		expect(typeof tool.args).toBe("object");
		expect(typeof tool.execute).toBe("function");
	});
});

describe("mem-delete", () => {
	test("deletes observation and returns confirmation", async () => {
		const obs = seedObservation();
		const tool = createDeleteTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute({ id: obs.id }, { sessionID: "sess-1", abort });
		expect(result).toContain("Deleted observation");
		expect(observations.getById(obs.id)).toBeNull();
	});

	test("rejects nonexistent observation", async () => {
		sessions.create("sess-1", PROJECT_PATH);
		const tool = createDeleteTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute({ id: "nonexistent" }, { sessionID: "sess-1", abort });
		expect(result).toContain("not found");
	});

	test("rejects observation from different project", async () => {
		sessions.create("other-sess", "/tmp/other-project");
		const otherObs = observations.create({
			sessionId: "other-sess",
			type: "discovery",
			title: "Other project obs",
			subtitle: "",
			facts: [],
			narrative: "From another project",
			concepts: [],
			filesRead: [],
			filesModified: [],
			rawToolOutput: "raw",
			toolName: "Read",
			tokenCount: 10,
			discoveryTokens: 0,
			importance: 3,
		});
		sessions.create("sess-1", PROJECT_PATH);
		const tool = createDeleteTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute({ id: otherObs.id }, { sessionID: "sess-1", abort });
		expect(result).toContain("not found");
		expect(observations.getById(otherObs.id)).not.toBeNull();
	});

	test("rejects missing id", async () => {
		const tool = createDeleteTool(observations, sessions, PROJECT_PATH);
		const result = await tool.execute({}, { sessionID: "sess-1", abort });
		expect(result).toContain("error");
	});

	test("has correct tool contract", () => {
		const tool = createDeleteTool(observations, sessions, PROJECT_PATH);
		expect(tool.name).toBe("mem-delete");
		expect(typeof tool.description).toBe("string");
		expect(typeof tool.args).toBe("object");
		expect(typeof tool.execute).toBe("function");
	});
});
