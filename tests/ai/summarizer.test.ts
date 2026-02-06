// =============================================================================
// open-mem — AI Summarizer Tests (Task 11)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { SessionSummarizer } from "../../src/ai/summarizer";
import type { Observation } from "../../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ConstructorParameters<typeof SessionSummarizer>[0]>) {
	return {
		provider: "anthropic",
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		maxTokensPerCompression: 1024,
		compressionEnabled: true,
		...overrides,
	};
}

function withMockGenerate(
	summarizer: SessionSummarizer,
	fn: (...args: unknown[]) => unknown,
): void {
	(summarizer as unknown as Record<string, unknown>)._generate = fn;
}

function makeObservation(overrides?: Partial<Observation>): Observation {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		subtitle: "JWT-based",
		facts: ["Uses RS256"],
		narrative: "The auth module uses JWT tokens.",
		concepts: ["JWT", "authentication"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		createdAt: "2026-01-01T00:00:00Z",
		tokenCount: 100,
		...overrides,
	};
}

const VALID_SUMMARY_XML = `<session_summary>
  <summary>Explored JWT authentication patterns in the codebase.</summary>
  <key_decisions><decision>Use RS256 algorithm</decision></key_decisions>
  <files_modified><file>src/auth.ts</file></files_modified>
  <concepts><concept>JWT</concept></concepts>
</session_summary>`;

// =============================================================================
// Tests
// =============================================================================

describe("SessionSummarizer", () => {
	test("summarize returns null for empty observations", async () => {
		const summarizer = new SessionSummarizer(makeConfig());
		const result = await summarizer.summarize("sess-1", []);
		expect(result).toBeNull();
	});

	test("summarize falls back when disabled", async () => {
		const summarizer = new SessionSummarizer(makeConfig({ compressionEnabled: false }));
		const result = await summarizer.summarize("sess-1", [
			makeObservation(),
			makeObservation({ id: "obs-2", type: "change", title: "Updated login" }),
		]);
		expect(result).not.toBeNull();
		expect(result?.summary).toContain("2 observations");
	});

	test("summarize calls API and parses response", async () => {
		const summarizer = new SessionSummarizer(makeConfig());
		withMockGenerate(summarizer, () => Promise.resolve({ text: VALID_SUMMARY_XML }));

		const result = await summarizer.summarize("sess-1", [makeObservation()]);
		expect(result).not.toBeNull();
		expect(result?.summary).toContain("JWT");
		expect(result?.keyDecisions).toContain("Use RS256 algorithm");
	});

	test("summarize falls back on API error", async () => {
		const summarizer = new SessionSummarizer(makeConfig());
		withMockGenerate(summarizer, () => Promise.reject(new Error("API down")));

		const result = await summarizer.summarize("sess-1", [makeObservation()]);
		// Should get a fallback summary, not null
		expect(result).not.toBeNull();
		expect(result?.summary).toContain("1 observations");
	});

	test("createFallbackSummary aggregates files", () => {
		const summarizer = new SessionSummarizer(makeConfig({ compressionEnabled: false }));
		const result = summarizer.createFallbackSummary([
			makeObservation({ filesModified: ["a.ts"] }),
			makeObservation({ filesModified: ["b.ts", "a.ts"] }),
		]);
		expect(result.filesModified).toContain("a.ts");
		expect(result.filesModified).toContain("b.ts");
		// Deduplication
		expect(result.filesModified.filter((f) => f === "a.ts")).toHaveLength(1);
	});

	test("createFallbackSummary aggregates concepts", () => {
		const summarizer = new SessionSummarizer(makeConfig({ compressionEnabled: false }));
		const result = summarizer.createFallbackSummary([
			makeObservation({ concepts: ["JWT", "auth"] }),
			makeObservation({ concepts: ["auth", "security"] }),
		]);
		expect(result.concepts).toContain("JWT");
		expect(result.concepts).toContain("auth");
		expect(result.concepts).toContain("security");
	});

	test("createFallbackSummary collects decisions", () => {
		const summarizer = new SessionSummarizer(makeConfig({ compressionEnabled: false }));
		const result = summarizer.createFallbackSummary([
			makeObservation({ type: "decision", title: "Use RS256" }),
			makeObservation({ type: "discovery", title: "Found bug" }),
			makeObservation({ type: "decision", title: "Switch to WAL" }),
		]);
		expect(result.keyDecisions).toEqual(["Use RS256", "Switch to WAL"]);
	});

	test("shouldSummarize false for < 2 observations", () => {
		const summarizer = new SessionSummarizer(makeConfig());
		expect(summarizer.shouldSummarize(0)).toBe(false);
		expect(summarizer.shouldSummarize(1)).toBe(false);
	});

	test("shouldSummarize true for >= 2 observations", () => {
		const summarizer = new SessionSummarizer(makeConfig());
		expect(summarizer.shouldSummarize(2)).toBe(true);
		expect(summarizer.shouldSummarize(10)).toBe(true);
	});
});
