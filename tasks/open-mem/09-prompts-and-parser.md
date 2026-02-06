# 09. Prompts and Parser

## Meta
- **ID**: open-mem-09
- **Feature**: open-mem
- **Phase**: 3
- **Priority**: P1
- **Depends On**: [open-mem-02]
- **Effort**: M (2-3h)
- **Tags**: [implementation, ai, prompts, parser]
- **Requires UX/DX Review**: false

## Objective
Create XML-based prompt templates for AI observation compression and session summarization, plus a robust XML response parser that extracts structured data from AI responses.

## Context
claude-mem uses an XML-based prompt/response format for AI compression. The prompts instruct the AI to extract structured observations (type, title, subtitle, facts, narrative, concepts, files) from raw tool output. The parser must handle malformed XML gracefully since AI responses aren't always perfectly formatted.

**User Requirements**: AI-powered compression of observations. Reuse claude-mem architectural patterns.

## Deliverables
- `src/ai/prompts.ts` — XML prompt templates for compression and summarization
- `src/ai/parser.ts` — XML response parser

## Implementation Steps

### Step 1: Create compression prompt template (`src/ai/prompts.ts`)
```typescript
export function buildCompressionPrompt(toolName: string, toolOutput: string, sessionContext?: string): string {
  return `<task>
Analyze the following tool output and extract a structured observation.
</task>

<tool_name>${toolName}</tool_name>

<tool_output>
${toolOutput}
</tool_output>

${sessionContext ? `<session_context>\n${sessionContext}\n</session_context>` : ""}

<instructions>
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
```

### Step 2: Create summarization prompt template
```typescript
export function buildSummarizationPrompt(
  observations: Array<{ type: string; title: string; narrative: string }>,
  sessionId: string
): string {
  const observationList = observations
    .map((o, i) => `  <obs index="${i + 1}" type="${o.type}">\n    <title>${o.title}</title>\n    <narrative>${o.narrative}</narrative>\n  </obs>`)
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
```

### Step 3: Create XML response parser (`src/ai/parser.ts`)
```typescript
import type { ObservationType } from "../types";

// Parsed observation from AI response
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

const VALID_TYPES: Set<string> = new Set([
  "decision", "bugfix", "feature", "refactor", "discovery", "change"
]);

// Extract content between XML tags (simple regex-based parser)
function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

// Extract all instances of a repeated tag
function extractAllTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const value = match[1].trim();
    if (value) matches.push(value);
  }
  return matches;
}

export function parseObservationResponse(response: string): ParsedObservation | null {
  try {
    const observation = extractTag(response, "observation");
    if (!observation) return null;
    
    const rawType = extractTag(observation, "type").toLowerCase();
    const type = VALID_TYPES.has(rawType) ? rawType as ObservationType : "discovery";
    
    const title = extractTag(observation, "title") || "Untitled observation";
    const subtitle = extractTag(observation, "subtitle");
    const narrative = extractTag(observation, "narrative");
    
    const factsBlock = extractTag(observation, "facts");
    const facts = extractAllTags(factsBlock, "fact");
    
    const conceptsBlock = extractTag(observation, "concepts");
    const concepts = extractAllTags(conceptsBlock, "concept");
    
    const filesReadBlock = extractTag(observation, "files_read");
    const filesRead = extractAllTags(filesReadBlock, "file");
    
    const filesModifiedBlock = extractTag(observation, "files_modified");
    const filesModified = extractAllTags(filesModifiedBlock, "file");
    
    return { type, title, subtitle, facts, narrative, concepts, filesRead, filesModified };
  } catch (error) {
    console.error("[open-mem] Failed to parse observation response:", error);
    return null;
  }
}

export function parseSummaryResponse(response: string): ParsedSummary | null {
  try {
    const summaryBlock = extractTag(response, "session_summary");
    if (!summaryBlock) return null;
    
    const summary = extractTag(summaryBlock, "summary") || "No summary available";
    
    const decisionsBlock = extractTag(summaryBlock, "key_decisions");
    const keyDecisions = extractAllTags(decisionsBlock, "decision");
    
    const filesBlock = extractTag(summaryBlock, "files_modified");
    const filesModified = extractAllTags(filesBlock, "file");
    
    const conceptsBlock = extractTag(summaryBlock, "concepts");
    const concepts = extractAllTags(conceptsBlock, "concept");
    
    return { summary, keyDecisions, filesModified, concepts };
  } catch (error) {
    console.error("[open-mem] Failed to parse summary response:", error);
    return null;
  }
}
```

### Step 4: Add token estimation utility
```typescript
// Rough token estimation (4 chars ≈ 1 token for English text)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/ai/prompts.ts` | Create | XML prompt templates for compression and summarization |
| `src/ai/parser.ts` | Create | XML response parser with extractTag/extractAllTags helpers |

## Acceptance Criteria
- [ ] `src/ai/prompts.ts` exports `buildCompressionPrompt` and `buildSummarizationPrompt`
- [ ] Compression prompt includes tool name, output, and optional session context
- [ ] Summarization prompt includes observation list with types and narratives
- [ ] `src/ai/parser.ts` exports `parseObservationResponse` and `parseSummaryResponse`
- [ ] Parser extracts all fields: type, title, subtitle, facts, narrative, concepts, filesRead, filesModified
- [ ] Parser handles malformed XML gracefully (returns null, doesn't throw)
- [ ] Parser validates observation type against allowed values (defaults to "discovery")
- [ ] Parser handles missing optional fields with sensible defaults
- [ ] `estimateTokens` function provides rough token count
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Quick parser test
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { parseObservationResponse } = require('./src/ai/parser.ts');
  const result = parseObservationResponse(\`
    <observation>
      <type>discovery</type>
      <title>Found auth pattern</title>
      <subtitle>JWT-based authentication</subtitle>
      <facts><fact>Uses RS256</fact><fact>1 hour expiry</fact></facts>
      <narrative>The auth module uses JWT tokens.</narrative>
      <concepts><concept>JWT</concept><concept>auth</concept></concepts>
      <files_read><file>src/auth.ts</file></files_read>
      <files_modified></files_modified>
    </observation>
  \`);
  console.log(JSON.stringify(result, null, 2));
"
```

## Notes
- The XML parser is intentionally regex-based rather than using a full XML parser library — AI responses often have minor formatting issues that a strict parser would reject
- The parser should be lenient: missing tags return empty strings/arrays, invalid types default to "discovery"
- Prompt templates use XML format because it's well-understood by Claude models and provides clear structure
- Consider adding a `buildBatchCompressionPrompt` later for processing multiple observations in one API call
- The `estimateTokens` function is a rough heuristic — for production, consider using a proper tokenizer
