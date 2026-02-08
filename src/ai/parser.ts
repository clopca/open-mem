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

/** Structured observation parsed from AI XML response. */
export interface ParsedObservation {
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
	discoveryTokens?: number;
	importance?: number;
}

/** Structured session summary parsed from AI XML response. */
export interface ParsedSummary {
	summary: string;
	keyDecisions: string[];
	filesModified: string[];
	concepts: string[];
	// Structured session fields (new format)
	request?: string;
	investigated?: string;
	learned?: string;
	completed?: string;
	nextSteps?: string;
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
export function parseObservationResponse(response: string): ParsedObservation | null {
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
	const concepts = extractAllTags(extractTag(observation, "concepts"), "concept");
	const filesRead = extractAllTags(extractTag(observation, "files_read"), "file");
	const filesModified = extractAllTags(extractTag(observation, "files_modified"), "file");

	const rawImportance = extractTag(observation, "importance");
	const parsedImportance = Number.parseInt(rawImportance, 10);
	const importance = Number.isNaN(parsedImportance)
		? 3
		: Math.max(1, Math.min(5, parsedImportance));

	return {
		type,
		title,
		subtitle,
		facts,
		narrative,
		concepts,
		filesRead,
		filesModified,
		importance,
	};
}

// -----------------------------------------------------------------------------
// Summary Parser
// -----------------------------------------------------------------------------

/**
 * Parse an AI response containing `<session_summary>...</session_summary>`
 * into a structured object. Returns `null` if unparseable.
 */
export function parseSummaryResponse(response: string): ParsedSummary | null {
	const block = extractTag(response, "session_summary");
	if (!block) return null;

	const summary = extractTag(block, "summary") || "No summary available";
	const keyDecisions = extractAllTags(extractTag(block, "key_decisions"), "decision");
	const filesModified = extractAllTags(extractTag(block, "files_modified"), "file");
	const concepts = extractAllTags(extractTag(block, "concepts"), "concept");

	const request = extractTag(block, "request") || undefined;
	const investigated = extractTag(block, "investigated") || undefined;
	const learned = extractTag(block, "learned") || undefined;
	const completed = extractTag(block, "completed") || undefined;
	const nextSteps = extractTag(block, "next_steps") || undefined;

	return {
		summary,
		keyDecisions,
		filesModified,
		concepts,
		request,
		investigated,
		learned,
		completed,
		nextSteps,
	};
}

// -----------------------------------------------------------------------------
// Reranking Parser
// -----------------------------------------------------------------------------

/** Parse an LLM reranking response into an ordered array of candidate indices. */
export function parseRerankingResponse(response: string): number[] | null {
	const block = extractTag(response, "reranked");
	if (!block) return null;

	const rawIndices = extractAllTags(block, "index");
	if (rawIndices.length === 0) return null;

	const indices: number[] = [];
	for (const raw of rawIndices) {
		const parsed = Number.parseInt(raw, 10);
		if (Number.isNaN(parsed) || parsed < 0) return null;
		indices.push(parsed);
	}

	return indices;
}

// -----------------------------------------------------------------------------
// Conflict Evaluation Parser
// -----------------------------------------------------------------------------

/** Possible outcomes of a conflict evaluation. */
export type ConflictOutcome = "new_fact" | "update" | "duplicate";

/** Result of evaluating whether a new observation conflicts with existing ones. */
export interface ConflictEvaluation {
	outcome: ConflictOutcome;
	supersedesId?: string;
	reason: string;
}

const VALID_CONFLICT_OUTCOMES = new Set<string>(["new_fact", "update", "duplicate"]);

/** Parse an LLM conflict evaluation response into a structured result. */
export function parseConflictEvaluationResponse(response: string): ConflictEvaluation | null {
	const block = extractTag(response, "evaluation");
	if (!block) return null;

	const rawOutcome = extractTag(block, "outcome").toLowerCase().trim();
	if (!VALID_CONFLICT_OUTCOMES.has(rawOutcome)) return null;

	const outcome = rawOutcome as ConflictOutcome;
	const reason = extractTag(block, "reason");
	if (!reason) return null;

	const supersedes = extractTag(block, "supersedes");

	const result: ConflictEvaluation = { outcome, reason };

	if (outcome === "update" && supersedes) {
		result.supersedesId = supersedes;
	}

	if (outcome === "update" && !result.supersedesId) {
		return null; // "update" requires a supersedes target
	}

	return result;
}

// -----------------------------------------------------------------------------
// Entity Extraction Parser
// -----------------------------------------------------------------------------

/** Classification of entity types extracted from observations. */
export type EntityType =
	| "technology"
	| "library"
	| "pattern"
	| "concept"
	| "file"
	| "person"
	| "project"
	| "other";

/** Types of relationships between extracted entities. */
export type RelationshipType =
	| "uses"
	| "depends_on"
	| "implements"
	| "extends"
	| "related_to"
	| "replaces"
	| "configures";

/** An entity extracted from observation text. */
export interface ParsedEntity {
	name: string;
	entityType: EntityType;
}

/** A relationship between two extracted entities. */
export interface ParsedRelation {
	sourceName: string;
	targetName: string;
	relationship: RelationshipType;
}

/** Complete result of entity extraction from an observation. */
export interface ParsedEntityExtraction {
	entities: ParsedEntity[];
	relations: ParsedRelation[];
}

const VALID_ENTITY_TYPES = new Set<string>([
	"technology",
	"library",
	"pattern",
	"concept",
	"file",
	"person",
	"project",
	"other",
]);

const VALID_RELATIONSHIP_TYPES = new Set<string>([
	"uses",
	"depends_on",
	"implements",
	"extends",
	"related_to",
	"replaces",
	"configures",
]);

/** Parse an LLM entity extraction response into entities and relations. */
export function parseEntityExtractionResponse(response: string): ParsedEntityExtraction | null {
	const extraction = extractTag(response, "extraction");
	if (!extraction) return null;

	const entitiesBlock = extractTag(extraction, "entities");
	const relationsBlock = extractTag(extraction, "relations");

	const rawEntities = extractAllTags(entitiesBlock, "entity");
	const entities: ParsedEntity[] = [];
	for (const raw of rawEntities) {
		const name = extractTag(raw, "name");
		if (!name) continue;
		const rawType = extractTag(raw, "type").toLowerCase();
		const entityType: EntityType = VALID_ENTITY_TYPES.has(rawType)
			? (rawType as EntityType)
			: "other";
		entities.push({ name, entityType });
	}

	const rawRelations = extractAllTags(relationsBlock, "relation");
	const relations: ParsedRelation[] = [];
	for (const raw of rawRelations) {
		const sourceName = extractTag(raw, "source");
		const targetName = extractTag(raw, "target");
		const rawRel = extractTag(raw, "relationship").toLowerCase();
		if (!sourceName || !targetName || !rawRel) continue;
		if (!VALID_RELATIONSHIP_TYPES.has(rawRel)) continue;
		relations.push({
			sourceName,
			targetName,
			relationship: rawRel as RelationshipType,
		});
	}

	return { entities, relations };
}

// -----------------------------------------------------------------------------
// Token Estimation
// -----------------------------------------------------------------------------

/** Rough token count (4 chars ~ 1 token for English text) */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
