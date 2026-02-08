// =============================================================================
// open-mem — XML Prompt Templates for AI Compression and Summarization
// =============================================================================

/**
 * Build a prompt that instructs the AI to compress raw tool output into a
 * structured observation (type, title, facts, narrative, concepts, files).
 */
export function buildCompressionPrompt(
	toolName: string,
	toolOutput: string,
	sessionContext?: string,
): string {
	const contextBlock = sessionContext
		? `<session_context>\n${sessionContext}\n</session_context>\n\n`
		: "";

	return `<task>
Analyze the following tool output and extract a structured observation.
</task>

<tool_name>${toolName}</tool_name>

<tool_output>
${toolOutput}
</tool_output>

${contextBlock}<instructions>
Extract a structured observation from the tool output. Determine the most appropriate type and provide a concise but informative summary.

When extracting concepts, prefer established vocabulary where appropriate:
- how-it-works: Technical mechanisms and behaviors
- why-it-exists: Rationale and motivations
- what-changed: Modifications and their effects
- problem-solution: Issues encountered and how they were resolved
- gotcha: Surprising behaviors, edge cases, or pitfalls
- pattern: Recurring design patterns or approaches
- trade-off: Deliberate compromises between competing concerns
You may also use any domain-specific concepts relevant to the observation.

Respond with EXACTLY this XML format:
<observation>
  <type>decision|bugfix|feature|refactor|discovery|change</type>
  <title>Brief descriptive title (max 80 chars)</title>
  <subtitle>One-line elaboration</subtitle>
  <importance>1-5 (1=trivial/routine, 2=low, 3=normal, 4=significant, 5=critical decision or discovery)</importance>
  <facts>
    <fact>Specific factual detail 1</fact>
    <fact>Specific factual detail 2</fact>
  </facts>
  <narrative>2-3 sentence narrative explaining what happened and why it matters</narrative>
  <concepts>
    <concept>relevant-concept-1</concept>
    <concept>relevant-concept-2</concept>
  </concepts>
  <files_read>
    <file>path/to/file/read</file>
  </files_read>
  <files_modified>
    <file>path/to/file/modified</file>
  </files_modified>
</observation>
</instructions>`;
}

/**
 * Build a prompt that instructs the AI to produce a session summary from
 * a list of observations.
 */
export function buildSummarizationPrompt(
	observations: ReadonlyArray<{
		type: string;
		title: string;
		narrative: string;
	}>,
	sessionId: string,
): string {
	const observationList = observations
		.map(
			(o, i) =>
				`  <obs index="${i + 1}" type="${o.type}">\n    <title>${o.title}</title>\n    <narrative>${o.narrative}</narrative>\n  </obs>`,
		)
		.join("\n");

	return `<task>
Summarize the following coding session based on its observations.
</task>

<session_id>${sessionId}</session_id>

<observations>
${observationList}
</observations>

<instructions>
Create a concise session summary. Focus on key decisions, outcomes, and patterns.

Respond with EXACTLY this XML format:
<session_summary>
  <request>What the user asked for (1-2 sentences)</request>
  <investigated>What was explored or researched</investigated>
  <learned>Key discoveries and insights</learned>
  <completed>What was accomplished</completed>
  <next_steps>What to do next (if any)</next_steps>
  <summary>2-4 sentence summary of the entire session</summary>
  <key_decisions>
    <decision>Important decision made during session</decision>
  </key_decisions>
  <files_modified>
    <file>path/to/modified/file</file>
  </files_modified>
  <concepts>
    <concept>key-concept</concept>
  </concepts>
</session_summary>
</instructions>`;
}

// -----------------------------------------------------------------------------
// Conflict Evaluation Prompt
// -----------------------------------------------------------------------------

/** An existing observation that may conflict with a new one. */
export interface ConflictCandidate {
	id: string;
	title: string;
	narrative: string;
	concepts: string[];
	type: string;
}

/** The new observation being evaluated for conflicts. */
export interface ConflictNewObservation {
	title: string;
	narrative: string;
	concepts: string[];
	type: string;
}

/**
 * Build a prompt that instructs the AI to evaluate whether a new observation
 * conflicts with, updates, or duplicates existing candidates.
 */
export function buildConflictEvaluationPrompt(
	newObs: ConflictNewObservation,
	candidates: ReadonlyArray<ConflictCandidate>,
): string {
	const candidateList = candidates
		.map(
			(c) =>
				`  <candidate id="${c.id}">
    <title>${c.title}</title>
    <narrative>${c.narrative}</narrative>
    <concepts>${c.concepts.join(", ")}</concepts>
    <type>${c.type}</type>
  </candidate>`,
		)
		.join("\n");

	return `<conflict_evaluation>
<new_observation>
  <title>${newObs.title}</title>
  <narrative>${newObs.narrative}</narrative>
  <concepts>${newObs.concepts.join(", ")}</concepts>
  <type>${newObs.type}</type>
</new_observation>
<existing_candidates>
${candidateList}
</existing_candidates>
<instructions>
Evaluate whether the new observation represents:
1. new_fact — genuinely new information not covered by any candidate
2. update — supersedes/updates an existing candidate (newer version of same info)
3. duplicate — semantically identical to an existing candidate

Respond with EXACTLY this XML format:
<evaluation>
  <outcome>new_fact|update|duplicate</outcome>
  <supersedes>candidate-id (only if outcome is update)</supersedes>
  <reason>Brief explanation</reason>
</evaluation>
</instructions>
</conflict_evaluation>`;
}

// -----------------------------------------------------------------------------
// Reranking Prompt
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Entity Extraction Prompt
// -----------------------------------------------------------------------------

/** Observation data used as input for entity extraction. */
export interface EntityExtractionObservation {
	title: string;
	type: string;
	narrative: string;
	facts: string[];
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
}

/**
 * Build a prompt that instructs the AI to extract entities and relationships
 * from an observation.
 */
export function buildEntityExtractionPrompt(obs: EntityExtractionObservation): string {
	const allFiles = [...obs.filesRead, ...obs.filesModified];

	return `<entity_extraction>
<observation>
  <title>${obs.title}</title>
  <type>${obs.type}</type>
  <narrative>${obs.narrative}</narrative>
  <facts>${obs.facts.join("\n")}</facts>
  <files>${allFiles.join("\n")}</files>
  <concepts>${obs.concepts.join(", ")}</concepts>
</observation>
<instructions>
Extract entities and relationships from this observation.

Entity types: technology, library, pattern, concept, file, person, project, other
Relationship types: uses, depends_on, implements, extends, related_to, replaces, configures

Extract entities that are clearly mentioned or strongly implied. For example, "React hooks" implies a relationship between React and hooks. Do not extract speculative relationships.
Respond with EXACTLY this XML format:
<extraction>
  <entities>
    <entity><name>React</name><type>library</type></entity>
    <entity><name>useState</name><type>pattern</type></entity>
  </entities>
  <relations>
    <relation><source>React</source><relationship>uses</relationship><target>useState</target></relation>
  </relations>
</extraction>
</instructions>
</entity_extraction>`;
}

// -----------------------------------------------------------------------------
// Reranking Prompt
// -----------------------------------------------------------------------------

/**
 * Build a prompt that instructs the AI to reorder search result candidates
 * by relevance to the query.
 */
export function buildRerankingPrompt(
	query: string,
	candidates: ReadonlyArray<{ title: string; narrative: string }>,
): string {
	const candidateList = candidates
		.map(
			(c, i) =>
				`  <candidate index="${i}"><title>${c.title}</title><narrative>${c.narrative}</narrative></candidate>`,
		)
		.join("\n");

	return `<rerank_request>
<query>${query}</query>
<candidates>
${candidateList}
</candidates>
<instructions>Reorder the candidates by relevance to the query. Return indices from most to least relevant.

Respond with EXACTLY this XML format:
<reranked>
  <index>3</index>
  <index>1</index>
  <index>0</index>
</reranked>
</instructions>
</rerank_request>`;
}
