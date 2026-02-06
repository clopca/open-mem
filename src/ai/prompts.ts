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

Respond with EXACTLY this XML format:
<observation>
  <type>decision|bugfix|feature|refactor|discovery|change</type>
  <title>Brief descriptive title (max 80 chars)</title>
  <subtitle>One-line elaboration</subtitle>
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
