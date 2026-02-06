import { describe, test, expect } from "bun:test";
import type {
	ObservationType,
	Observation,
	ObservationIndex,
	Session,
	SessionSummary,
	PendingMessage,
	QueueItem,
	OpenMemConfig,
	Plugin,
	Hooks,
	PluginInput,
	SearchQuery,
	SearchResult,
	TimelineEntry,
	OpenCodeEvent,
	ToolDefinition,
	ToolContext,
} from "../src/types";

describe("Types and Interfaces", () => {
	test("types are importable", () => {
		// Verify that all types can be imported without TypeScript errors.
		// If this test compiles and runs, the types exist and are exported.
		const observation: Observation = {
			id: "obs-1",
			sessionId: "sess-1",
			type: "decision",
			title: "Test observation",
			subtitle: "Subtitle",
			facts: ["fact1"],
			narrative: "A narrative",
			concepts: ["concept1"],
			filesRead: ["file1.ts"],
			filesModified: ["file2.ts"],
			rawToolOutput: "raw output",
			toolName: "Bash",
			createdAt: new Date().toISOString(),
			tokenCount: 100,
		};

		const session: Session = {
			id: "sess-1",
			projectPath: "/tmp/proj",
			startedAt: new Date().toISOString(),
			endedAt: null,
			status: "active",
			observationCount: 0,
			summaryId: null,
		};

		const config: OpenMemConfig = {
			dbPath: ".open-mem/memory.db",
			apiKey: undefined,
			model: "claude-sonnet-4-20250514",
			maxTokensPerCompression: 1024,
			compressionEnabled: true,
			contextInjectionEnabled: true,
			maxContextTokens: 4000,
			batchSize: 5,
			batchIntervalMs: 30_000,
			ignoredTools: [],
			minOutputLength: 50,
			maxIndexEntries: 20,
			sensitivePatterns: [],
			retentionDays: 90,
			maxDatabaseSizeMb: 500,
			logLevel: "warn",
		};

		// If we reach here, all types compiled successfully
		expect(observation).toBeDefined();
		expect(session).toBeDefined();
		expect(config).toBeDefined();
	});

	test("ObservationType values", () => {
		// Arrange: all 6 valid observation type values
		const validTypes: ObservationType[] = [
			"decision",
			"bugfix",
			"feature",
			"refactor",
			"discovery",
			"change",
		];

		// Act & Assert: each value is a valid string
		expect(validTypes).toHaveLength(6);
		for (const t of validTypes) {
			expect(typeof t).toBe("string");
		}

		// Verify the exact set of values
		expect(validTypes).toContain("decision");
		expect(validTypes).toContain("bugfix");
		expect(validTypes).toContain("feature");
		expect(validTypes).toContain("refactor");
		expect(validTypes).toContain("discovery");
		expect(validTypes).toContain("change");
	});

	test("Observation shape", () => {
		// Arrange: create a full observation object
		const observation: Observation = {
			id: "obs-123",
			sessionId: "sess-456",
			type: "bugfix",
			title: "Fixed null pointer in auth module",
			subtitle: "Auth module crash on empty token",
			facts: ["Token was null", "Added null check"],
			narrative: "The auth module crashed when receiving an empty token.",
			concepts: ["authentication", "null-safety"],
			filesRead: ["src/auth.ts"],
			filesModified: ["src/auth.ts"],
			rawToolOutput: "Error: Cannot read property 'length' of null",
			toolName: "Bash",
			createdAt: "2026-02-06T12:00:00.000Z",
			tokenCount: 250,
		};

		// Assert: all required fields are present and have correct types
		expect(typeof observation.id).toBe("string");
		expect(typeof observation.sessionId).toBe("string");
		expect(typeof observation.type).toBe("string");
		expect(typeof observation.title).toBe("string");
		expect(typeof observation.subtitle).toBe("string");
		expect(Array.isArray(observation.facts)).toBe(true);
		expect(typeof observation.narrative).toBe("string");
		expect(Array.isArray(observation.concepts)).toBe(true);
		expect(Array.isArray(observation.filesRead)).toBe(true);
		expect(Array.isArray(observation.filesModified)).toBe(true);
		expect(typeof observation.rawToolOutput).toBe("string");
		expect(typeof observation.toolName).toBe("string");
		expect(typeof observation.createdAt).toBe("string");
		expect(typeof observation.tokenCount).toBe("number");
	});

	test("ObservationIndex is subset of Observation", () => {
		// Arrange: create a full observation
		const observation: Observation = {
			id: "obs-789",
			sessionId: "sess-101",
			type: "feature",
			title: "Added user search",
			subtitle: "Full-text search for users",
			facts: ["Implemented FTS5"],
			narrative: "Added full-text search capability.",
			concepts: ["search", "fts5"],
			filesRead: ["src/search.ts"],
			filesModified: ["src/search.ts"],
			rawToolOutput: "Search results: ...",
			toolName: "Read",
			createdAt: "2026-02-06T13:00:00.000Z",
			tokenCount: 150,
		};

		// Act: create an index from the observation (picking only index fields)
		const index: ObservationIndex = {
			id: observation.id,
			sessionId: observation.sessionId,
			type: observation.type,
			title: observation.title,
			tokenCount: observation.tokenCount,
			createdAt: observation.createdAt,
		};

		// Assert: index has fewer fields than observation
		const observationKeys = Object.keys(observation);
		const indexKeys = Object.keys(index);

		expect(indexKeys.length).toBeLessThan(observationKeys.length);

		// Assert: every key in index exists in observation
		for (const key of indexKeys) {
			expect(observationKeys).toContain(key);
		}

		// Assert: index has exactly the expected fields
		expect(indexKeys).toHaveLength(6);
		expect(index.id).toBe(observation.id);
		expect(index.sessionId).toBe(observation.sessionId);
		expect(index.type).toBe(observation.type);
		expect(index.title).toBe(observation.title);
		expect(index.tokenCount).toBe(observation.tokenCount);
		expect(index.createdAt).toBe(observation.createdAt);
	});
});
