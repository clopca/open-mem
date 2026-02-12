// =============================================================================
// open-mem — Privacy Utilities Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { redactSensitive, stripPrivateBlocks } from "../../src/utils/privacy";

// =============================================================================
// stripPrivateBlocks
// =============================================================================

describe("stripPrivateBlocks", () => {
	test("strips single private block", () => {
		const result = stripPrivateBlocks("before <private>secret</private> after");
		expect(result).toBe("before  after");
	});

	test("strips multiple private blocks", () => {
		const result = stripPrivateBlocks(
			"start <private>first</private> middle <private>second</private> end",
		);
		expect(result).toBe("start  middle  end");
	});

	test("handles multiline private content", () => {
		const result = stripPrivateBlocks("before <private>\nline1\nline2\n</private> after");
		expect(result).toBe("before  after");
	});

	test("is case-insensitive", () => {
		expect(stripPrivateBlocks("a <Private>x</Private> b")).toBe("a  b");
		expect(stripPrivateBlocks("a <PRIVATE>x</PRIVATE> b")).toBe("a  b");
		expect(stripPrivateBlocks("a <pRiVaTe>x</pRiVaTe> b")).toBe("a  b");
	});

	test("uses custom replacement marker", () => {
		const result = stripPrivateBlocks("visible <private>secret</private> more", "[PRIVATE]");
		expect(result).toBe("visible [PRIVATE] more");
	});

	test("handles nested private tags (non-greedy strips inner first)", () => {
		const result = stripPrivateBlocks(
			"before <private>outer <private>inner</private> outer</private> after",
		);
		// Non-greedy regex matches shortest span: <private>outer <private>inner</private>
		expect(result).toBe("before  outer</private> after");
	});

	test("returns empty/falsy input unchanged", () => {
		expect(stripPrivateBlocks("")).toBe("");
		// biome-ignore lint/suspicious/noExplicitAny: testing edge case with non-string input
		expect(stripPrivateBlocks(null as any)).toBeNull();
		// biome-ignore lint/suspicious/noExplicitAny: testing edge case with non-string input
		expect(stripPrivateBlocks(undefined as any)).toBeUndefined();
	});

	test("preserves text without private tags", () => {
		const text = "this is normal text without any private tags";
		expect(stripPrivateBlocks(text)).toBe(text);
	});

	test("handles private block that is the entire content", () => {
		const result = stripPrivateBlocks("<private>everything is secret</private>");
		expect(result).toBe("");
	});

	test("handles adjacent private blocks", () => {
		const result = stripPrivateBlocks("<private>a</private><private>b</private>");
		expect(result).toBe("");
	});
});

// =============================================================================
// redactSensitive
// =============================================================================

describe("redactSensitive", () => {
	test("redacts content matching a single pattern", () => {
		const result = redactSensitive("key is sk-abc123XYZ here", ["sk-[a-zA-Z0-9]+"]);
		expect(result).toBe("key is [REDACTED] here");
	});

	test("redacts content matching multiple patterns", () => {
		const result = redactSensitive("key sk-abc123 and token ghp_xyz789", [
			"sk-[a-zA-Z0-9]+",
			"ghp_[a-zA-Z0-9]+",
		]);
		expect(result).toBe("key [REDACTED] and token [REDACTED]");
	});

	test("uses custom replacement", () => {
		const result = redactSensitive("password=secret123", ["secret123"], "***");
		expect(result).toBe("password=***");
	});

	test("skips invalid regex patterns gracefully", () => {
		const result = redactSensitive("text with sk-abc123 here", ["[invalid", "sk-[a-zA-Z0-9]+"]);
		expect(result).toBe("text with [REDACTED] here");
	});

	test("returns text unchanged when no patterns match", () => {
		const text = "nothing sensitive here";
		expect(redactSensitive(text, ["sk-[a-zA-Z0-9]+"])).toBe(text);
	});

	test("returns text unchanged with empty patterns array", () => {
		const text = "some text";
		expect(redactSensitive(text, [])).toBe(text);
	});

	test("returns empty/falsy input unchanged", () => {
		expect(redactSensitive("", ["pattern"])).toBe("");
		// biome-ignore lint/suspicious/noExplicitAny: testing edge case with non-string input
		expect(redactSensitive(null as any, ["pattern"])).toBeNull();
	});

	test("redacts all occurrences of a pattern (global flag)", () => {
		const result = redactSensitive("sk-aaa and sk-bbb and sk-ccc", ["sk-[a-z]+"]);
		expect(result).toBe("[REDACTED] and [REDACTED] and [REDACTED]");
	});
});
