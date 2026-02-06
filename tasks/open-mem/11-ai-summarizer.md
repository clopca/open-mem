# 11. AI Summarizer

## Meta
- **ID**: open-mem-11
- **Feature**: open-mem
- **Phase**: 3
- **Priority**: P2
- **Depends On**: [open-mem-09, open-mem-10]
- **Effort**: M (2h)
- **Tags**: [implementation, ai, summarization]
- **Requires UX/DX Review**: false

## Objective
Implement the AI session summarizer that generates concise summaries of coding sessions based on their observations.

## Context
When a session ends (or goes idle), the summarizer collects all observations from that session and generates a high-level summary. This summary is used for context injection in future sessions — it provides a quick overview of what happened without needing to load all individual observations.

**User Requirements**: AI-powered compression. Reuse claude-mem architectural patterns (session summaries).

## Deliverables
- `src/ai/summarizer.ts` — AI session summarization

## Implementation Steps

### Step 1: Create SessionSummarizer class
```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { OpenMemConfig, Observation, SessionSummary } from "../types";
import { buildSummarizationPrompt } from "./prompts";
import { parseSummaryResponse, estimateTokens } from "./parser";
import type { ParsedSummary } from "./parser";

export class SessionSummarizer {
  private client: Anthropic;
  private config: OpenMemConfig;
  
  constructor(config: OpenMemConfig) {
    this.config = config;
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
  }
}
```

### Step 2: Implement summarize method
```typescript
async summarize(
  sessionId: string,
  observations: Observation[]
): Promise<ParsedSummary | null> {
  if (!this.config.compressionEnabled || !this.config.apiKey) {
    return this.createFallbackSummary(observations);
  }
  
  if (observations.length === 0) {
    return null;
  }
  
  // Build observation list for prompt
  const observationData = observations.map(o => ({
    type: o.type,
    title: o.title,
    narrative: o.narrative,
  }));
  
  const prompt = buildSummarizationPrompt(observationData, sessionId);
  
  try {
    const response = await this.client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokensPerCompression,
      messages: [
        { role: "user", content: prompt },
      ],
    });
    
    const text = response.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("");
    
    const parsed = parseSummaryResponse(text);
    if (!parsed) {
      console.warn("[open-mem] Failed to parse summarization response for session:", sessionId);
      return this.createFallbackSummary(observations);
    }
    
    return parsed;
  } catch (error) {
    console.error("[open-mem] Summarization API error:", error);
    return this.createFallbackSummary(observations);
  }
}
```

### Step 3: Implement fallback summarizer
```typescript
createFallbackSummary(observations: Observation[]): ParsedSummary {
  // Collect unique files and concepts across all observations
  const allFiles = new Set<string>();
  const allConcepts = new Set<string>();
  const decisions: string[] = [];
  
  for (const obs of observations) {
    obs.filesModified.forEach(f => allFiles.add(f));
    obs.concepts.forEach(c => allConcepts.add(c));
    if (obs.type === "decision") {
      decisions.push(obs.title);
    }
  }
  
  // Build a simple summary from observation titles
  const typeGroups = new Map<string, number>();
  for (const obs of observations) {
    typeGroups.set(obs.type, (typeGroups.get(obs.type) || 0) + 1);
  }
  
  const typeSummary = Array.from(typeGroups.entries())
    .map(([type, count]) => `${count} ${type}${count > 1 ? "s" : ""}`)
    .join(", ");
  
  return {
    summary: `Session with ${observations.length} observations: ${typeSummary}. Files modified: ${allFiles.size}. Key concepts: ${Array.from(allConcepts).slice(0, 5).join(", ")}.`,
    keyDecisions: decisions.slice(0, 5),
    filesModified: Array.from(allFiles),
    concepts: Array.from(allConcepts),
  };
}
```

### Step 4: Add shouldSummarize check
```typescript
// Determine if a session has enough content to warrant summarization
shouldSummarize(observationCount: number): boolean {
  // Don't summarize sessions with very few observations
  return observationCount >= 2;
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/ai/summarizer.ts` | Create | SessionSummarizer class with summarize, fallback, shouldSummarize |

## Acceptance Criteria
- [ ] `src/ai/summarizer.ts` exports `SessionSummarizer` class
- [ ] `summarize()` sends observations to Anthropic API with summarization prompt
- [ ] `summarize()` parses XML response into ParsedSummary
- [ ] `summarize()` falls back to `createFallbackSummary` on API error
- [ ] `summarize()` falls back when compression is disabled or no API key
- [ ] `summarize()` returns null for empty observation lists
- [ ] `createFallbackSummary()` aggregates files, concepts, and decisions from observations
- [ ] `createFallbackSummary()` produces a readable summary string
- [ ] `shouldSummarize()` returns false for sessions with < 2 observations
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Test fallback summarizer
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { SessionSummarizer } = require('./src/ai/summarizer.ts');
  const summarizer = new SessionSummarizer({
    compressionEnabled: false,
    apiKey: undefined,
    model: 'claude-sonnet-4-20250514',
    maxTokensPerCompression: 1024,
  });
  const summary = summarizer.createFallbackSummary([
    { type: 'discovery', title: 'Found auth pattern', narrative: 'JWT auth', concepts: ['JWT'], filesModified: [], filesRead: ['src/auth.ts'] },
    { type: 'change', title: 'Updated login', narrative: 'Fixed login', concepts: ['auth'], filesModified: ['src/login.ts'], filesRead: [] },
  ]);
  console.log('Summary:', JSON.stringify(summary, null, 2));
"
```

## Notes
- The summarizer shares the Anthropic client pattern with the compressor — consider extracting a shared base class or utility if needed
- Fallback summaries are less informative but ensure every session gets some summary
- The `shouldSummarize` threshold of 2 observations prevents summarizing trivial sessions
- Consider adding a `maxObservationsForSummary` config to limit the number of observations sent to the API (to control costs)
- Session summarization typically happens once per session (on idle or end), so API cost is manageable
