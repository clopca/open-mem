import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "../../src/db/database";
import { cleanupTestDb, createTestDb } from "../db/helpers";

interface TranscriptFixture {
	name: string;
	messages: Array<Record<string, unknown>>;
	expected?: Array<Record<string, unknown>>;
	expectedContains?: Array<Record<string, unknown>>;
	outputContains?: Array<{ index: number; textIncludes: string[] }>;
}

let db: Database;
let dbPath: string;

beforeEach(() => {
	const result = createTestDb();
	db = result.db;
	dbPath = result.dbPath;
});

afterEach(() => {
	db.close();
	cleanupTestDb(dbPath);
});

async function callServer(messages: Array<Record<string, unknown>>): Promise<unknown[]> {
	const input = `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
	const helperPath = `${import.meta.dir}/mcp-server-helper.ts`;

	const proc = Bun.spawn(["bun", "run", helperPath, dbPath], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(input);
	proc.stdin.end();

	const output = await new Response(proc.stdout).text();
	proc.kill();

	return output
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line.trim()) as unknown);
}

function expectObjectContains(actual: unknown, expected: unknown): void {
	if (Array.isArray(expected)) {
		expect(Array.isArray(actual)).toBe(true);
		const actualArray = actual as unknown[];
		expect(actualArray.length).toBeGreaterThanOrEqual(expected.length);
		for (let i = 0; i < expected.length; i++) {
			expectObjectContains(actualArray[i], expected[i]);
		}
		return;
	}

	if (expected && typeof expected === "object") {
		expect(typeof actual).toBe("object");
		expect(actual).not.toBeNull();
		const actualObject = actual as Record<string, unknown>;
		const expectedObject = expected as Record<string, unknown>;
		for (const [key, value] of Object.entries(expectedObject)) {
			expect(actualObject).toHaveProperty(key);
			expectObjectContains(actualObject[key], value);
		}
		return;
	}

	expect(actual).toEqual(expected);
}

function loadFixtures(): TranscriptFixture[] {
	const fixturesDir = join(import.meta.dir, "../fixtures/mcp-transcripts");
	const files = readdirSync(fixturesDir)
		.filter((file) => file.endsWith(".json"))
		.sort();

	return files.map((file) =>
		JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as TranscriptFixture,
	);
}

describe("MCP transcript harness", () => {
	const fixtures = loadFixtures();

	for (const fixture of fixtures) {
		test(fixture.name, async () => {
			const responses = await callServer(fixture.messages);

			if (fixture.expected) {
				expect(responses).toEqual(fixture.expected);
			}

			if (fixture.expectedContains) {
				expect(responses.length).toBeGreaterThanOrEqual(fixture.expectedContains.length);
				for (let i = 0; i < fixture.expectedContains.length; i++) {
					expectObjectContains(responses[i], fixture.expectedContains[i]);
				}
			}

			if (fixture.outputContains) {
				for (const assertion of fixture.outputContains) {
					expect(assertion.index).toBeLessThan(responses.length);
					const line = JSON.stringify(responses[assertion.index]);
					for (const expectedText of assertion.textIncludes) {
						expect(line).toContain(expectedText);
					}
				}
			}
		});
	}
});
