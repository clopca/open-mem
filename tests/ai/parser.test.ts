// =============================================================================
// open-mem — Prompt & Parser Tests (Task 09)
// =============================================================================

import { describe, test, expect } from "bun:test";
import {
	buildCompressionPrompt,
	buildSummarizationPrompt,
} from "../../src/ai/prompts";
import {
	parseObservationResponse,
	parseSummaryResponse,
	estimateTokens,
} from "../../src/ai/parser";

// =============================================================================
// Prompt Construction
// =============================================================================

describe("buildCompressionPrompt", () => {
	test("includes tool name", () => {
		const prompt = buildCompressionPrompt("Read", "file contents");
		expect(prompt).toContain("<tool_name>Read</tool_name>");
	});

	test("includes tool output", () => {
		const prompt = buildCompressionPrompt("Bash", "npm test output here");
		expect(prompt).toContain("npm test output here");
	});

	test("includes session context when provided", () => {
		const prompt = buildCompressionPrompt("Read", "output", "some context");
		expect(prompt).toContain("<session_context>");
		expect(prompt).toContain("some context");
	});

	test("excludes session context block when not provided", () => {
		const prompt = buildCompressionPrompt("Read", "output");
		expect(prompt).not.toContain("<session_context>");
	});
});

describe("buildSummarizationPrompt", () => {
	test("includes all observation titles", () => {
		const observations = [
			{ type: "discovery", title: "Found auth", narrative: "JWT" },
			{ type: "change", title: "Updated login", narrative: "Fixed" },
			{ type: "decision", title: "Use RS256", narrative: "Decided" },
		];
		const prompt = buildSummarizationPrompt(observations, "sess-1");
		expect(prompt).toContain("Found auth");
		expect(prompt).toContain("Updated login");
		expect(prompt).toContain("Use RS256");
		expect(prompt).toContain("sess-1");
	});
});

// =============================================================================
// Observation Parser
// =============================================================================

describe("parseObservationResponse", () => {
	const VALID_XML = `
<observation>
  <type>discovery</type>
  <title>Found auth pattern</title>
  <subtitle>JWT-based authentication</subtitle>
  <facts>
    <fact>Uses RS256 algorithm</fact>
    <fact>Token expires in 1 hour</fact>
    <fact>Refresh tokens supported</fact>
  </facts>
  <narrative>The auth module uses JWT tokens with RS256.</narrative>
  <concepts>
    <concept>JWT</concept>
    <concept>authentication</concept>
  </concepts>
  <files_read>
    <file>src/auth.ts</file>
    <file>src/middleware.ts</file>
  </files_read>
  <files_modified>
    <file>src/login.ts</file>
  </files_modified>
</observation>`;

	test("parses valid XML with all fields", () => {
		const result = parseObservationResponse(VALID_XML);
		expect(result).not.toBeNull();
		expect(result?.type).toBe("discovery");
		expect(result?.title).toBe("Found auth pattern");
		expect(result?.subtitle).toBe("JWT-based authentication");
		expect(result?.narrative).toContain("JWT tokens");
	});

	test("extracts all facts", () => {
		const result = parseObservationResponse(VALID_XML);
		expect(result?.facts).toHaveLength(3);
		expect(result?.facts).toContain("Uses RS256 algorithm");
		expect(result?.facts).toContain("Token expires in 1 hour");
	});

	test("extracts all concepts", () => {
		const result = parseObservationResponse(VALID_XML);
		expect(result?.concepts).toEqual(["JWT", "authentication"]);
	});

	test("extracts files_read and files_modified", () => {
		const result = parseObservationResponse(VALID_XML);
		expect(result?.filesRead).toEqual(["src/auth.ts", "src/middleware.ts"]);
		expect(result?.filesModified).toEqual(["src/login.ts"]);
	});

	test("defaults invalid type to discovery", () => {
		const xml =
			"<observation><type>unknown_type</type><title>Test</title></observation>";
		const result = parseObservationResponse(xml);
		expect(result?.type).toBe("discovery");
	});

	test("returns null for malformed XML", () => {
		expect(parseObservationResponse("not xml at all")).toBeNull();
		expect(parseObservationResponse("")).toBeNull();
		expect(parseObservationResponse("<foo>bar</foo>")).toBeNull();
	});

	test("uses defaults for missing optional tags", () => {
		const xml =
			"<observation><type>bugfix</type><title>Fixed crash</title></observation>";
		const result = parseObservationResponse(xml);
		expect(result?.type).toBe("bugfix");
		expect(result?.title).toBe("Fixed crash");
		expect(result?.subtitle).toBe("");
		expect(result?.narrative).toBe("");
		expect(result?.facts).toEqual([]);
		expect(result?.concepts).toEqual([]);
		expect(result?.filesRead).toEqual([]);
		expect(result?.filesModified).toEqual([]);
	});

	test("defaults missing title to Untitled observation", () => {
		const xml = "<observation><type>change</type></observation>";
		const result = parseObservationResponse(xml);
		expect(result?.title).toBe("Untitled observation");
	});
});

// =============================================================================
// Summary Parser
// =============================================================================

describe("parseSummaryResponse", () => {
	test("parses valid summary XML", () => {
		const xml = `
<session_summary>
  <summary>Implemented JWT authentication with refresh tokens.</summary>
  <key_decisions>
    <decision>Use RS256 algorithm</decision>
    <decision>1 hour token expiry</decision>
  </key_decisions>
  <files_modified>
    <file>src/auth.ts</file>
  </files_modified>
  <concepts>
    <concept>JWT</concept>
    <concept>authentication</concept>
  </concepts>
</session_summary>`;
		const result = parseSummaryResponse(xml);
		expect(result).not.toBeNull();
		expect(result?.summary).toContain("JWT authentication");
		expect(result?.keyDecisions).toHaveLength(2);
		expect(result?.filesModified).toEqual(["src/auth.ts"]);
		expect(result?.concepts).toEqual(["JWT", "authentication"]);
	});

	test("returns null for malformed XML", () => {
		expect(parseSummaryResponse("not xml")).toBeNull();
		expect(parseSummaryResponse("")).toBeNull();
	});
});

// =============================================================================
// Token Estimation
// =============================================================================

describe("estimateTokens", () => {
	test("provides rough token count", () => {
		// "hello world" = 11 chars => ~3 tokens
		const tokens = estimateTokens("hello world");
		expect(tokens).toBe(3);
	});

	test("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	test("scales linearly with text length", () => {
		const short = estimateTokens("a".repeat(100));
		const long = estimateTokens("a".repeat(400));
		expect(long).toBe(short * 4);
	});
});
