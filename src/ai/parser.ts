// =============================================================================
// open-mem — XML Response Parser
// =============================================================================
//
// Regex-based parser for AI XML responses. Intentionally lenient — AI output
// may have minor formatting issues that a strict XML parser would reject.
// =============================================================================

import type { ObservationType } from "../types";

// -----------------------------------------------------------------------------
// Parsed Result Types
// -----------------------------------------------------------------------------

export interface ParsedObservation {
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
}

export interface ParsedSummary {
	summary: string;
	keyDecisions: string[];
	filesModified: string[];
	concepts: string[];
}

// -----------------------------------------------------------------------------
// Valid Observation Types
// -----------------------------------------------------------------------------

const VALID_TYPES = new Set<string>([
	"decision",
	"bugfix",
	"feature",
	"refactor",
	"discovery",
	"change",
]);

// -----------------------------------------------------------------------------
// Low-level Tag Extractors
// -----------------------------------------------------------------------------

/** Extract the text content of the first occurrence of `<tag>...</tag>` */
function extractTag(xml: string, tag: string): string {
	const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
	const match = xml.match(regex);
	return match ? match[1].trim() : "";
}

/** Extract text content of every `<tag>...</tag>` in the string */
function extractAllTags(xml: string, tag: string): string[] {
	const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
	const results: string[] = [];
	for (const match of xml.matchAll(regex)) {
		const value = match[1].trim();
		if (value) results.push(value);
	}
	return results;
}

// -----------------------------------------------------------------------------
// Observation Parser
// -----------------------------------------------------------------------------

/**
 * Parse an AI response containing `<observation>...</observation>` XML into
 * a structured object. Returns `null` if the response cannot be parsed at all.
 */
export function parseObservationResponse(
	response: string,
): ParsedObservation | null {
	const observation = extractTag(response, "observation");
	if (!observation) return null;

	const rawType = extractTag(observation, "type").toLowerCase();
	const type: ObservationType = VALID_TYPES.has(rawType)
		? (rawType as ObservationType)
		: "discovery";

	const title = extractTag(observation, "title") || "Untitled observation";
	const subtitle = extractTag(observation, "subtitle");
	const narrative = extractTag(observation, "narrative");

	const facts = extractAllTags(extractTag(observation, "facts"), "fact");
	const concepts = extractAllTags(
		extractTag(observation, "concepts"),
		"concept",
	);
	const filesRead = extractAllTags(
		extractTag(observation, "files_read"),
		"file",
	);
	const filesModified = extractAllTags(
		extractTag(observation, "files_modified"),
		"file",
	);

	return {
		type,
		title,
		subtitle,
		facts,
		narrative,
		concepts,
		filesRead,
		filesModified,
	};
}

// -----------------------------------------------------------------------------
// Summary Parser
// -----------------------------------------------------------------------------

/**
 * Parse an AI response containing `<session_summary>...</session_summary>`
 * into a structured object. Returns `null` if unparseable.
 */
export function parseSummaryResponse(
	response: string,
): ParsedSummary | null {
	const block = extractTag(response, "session_summary");
	if (!block) return null;

	const summary = extractTag(block, "summary") || "No summary available";
	const keyDecisions = extractAllTags(
		extractTag(block, "key_decisions"),
		"decision",
	);
	const filesModified = extractAllTags(
		extractTag(block, "files_modified"),
		"file",
	);
	const concepts = extractAllTags(
		extractTag(block, "concepts"),
		"concept",
	);

	return { summary, keyDecisions, filesModified, concepts };
}

// -----------------------------------------------------------------------------
// Token Estimation
// -----------------------------------------------------------------------------

/** Rough token count (4 chars ~ 1 token for English text) */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
