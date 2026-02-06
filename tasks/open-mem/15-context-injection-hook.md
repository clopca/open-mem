# 15. Context Injection Hook

## Meta
- **ID**: open-mem-15
- **Feature**: open-mem
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [open-mem-07, open-mem-13]
- **Effort**: L (3-4h)
- **Tags**: [implementation, hooks, context-injection, progressive-disclosure]
- **Requires UX/DX Review**: true

## Objective
Implement the `experimental.chat.system.transform` hook for injecting relevant context from past sessions into new sessions, using progressive disclosure (index first, details on demand).

## Context
This is the "recall" side of the memory system. When a new session starts, the context injection hook appends relevant past observations and session summaries to the system prompt. It uses progressive disclosure: first inject a lightweight index of past observations, then let the agent request full details via the mem-search tool.

**User Requirements**: Context injection via `session.created` events. Reuse claude-mem architectural patterns (progressive disclosure).

## Deliverables
- `src/hooks/context-inject.ts` — `experimental.chat.system.transform` handler
- `src/context/builder.ts` — Context string builder
- `src/context/progressive.ts` — Progressive disclosure logic
- `src/hooks/compaction.ts` — `experimental.session.compacting` handler

## Implementation Steps

### Step 1: Create progressive disclosure logic (`src/context/progressive.ts`)
```typescript
import type { ObservationIndex, SessionSummary, Session } from "../types";
import { estimateTokens } from "../ai/parser";

export interface ProgressiveContext {
  recentSummaries: SessionSummary[];
  observationIndex: ObservationIndex[];
  totalTokens: number;
}

export function buildProgressiveContext(
  recentSessions: Session[],
  summaries: SessionSummary[],
  observationIndex: ObservationIndex[],
  maxTokens: number,
): ProgressiveContext {
  let tokenBudget = maxTokens;
  const includedSummaries: SessionSummary[] = [];
  const includedIndex: ObservationIndex[] = [];
  
  // Priority 1: Recent session summaries (most valuable)
  for (const summary of summaries) {
    const tokens = summary.tokenCount || estimateTokens(summary.summary);
    if (tokenBudget - tokens < 0) break;
    includedSummaries.push(summary);
    tokenBudget -= tokens;
  }
  
  // Priority 2: Observation index entries (lightweight)
  for (const entry of observationIndex) {
    const tokens = entry.tokenCount || estimateTokens(entry.title);
    // Index entries are small, but cap at budget
    if (tokenBudget - tokens < 0) break;
    includedIndex.push(entry);
    tokenBudget -= tokens;
  }
  
  return {
    recentSummaries: includedSummaries,
    observationIndex: includedIndex,
    totalTokens: maxTokens - tokenBudget,
  };
}
```

### Step 2: Create context string builder (`src/context/builder.ts`)
```typescript
import type { ProgressiveContext } from "./progressive";
import type { ObservationIndex, SessionSummary } from "../types";

export function buildContextString(context: ProgressiveContext): string {
  const parts: string[] = [];
  
  parts.push("<open_mem_context>");
  parts.push("  <description>Past session memory from open-mem plugin. Use mem-search tool to retrieve full observation details.</description>");
  
  // Recent session summaries
  if (context.recentSummaries.length > 0) {
    parts.push("  <recent_sessions>");
    for (const summary of context.recentSummaries) {
      parts.push(`    <session id="${summary.sessionId}">`);
      parts.push(`      <summary>${summary.summary}</summary>`);
      if (summary.keyDecisions.length > 0) {
        parts.push(`      <decisions>${summary.keyDecisions.join("; ")}</decisions>`);
      }
      if (summary.concepts.length > 0) {
        parts.push(`      <concepts>${summary.concepts.join(", ")}</concepts>`);
      }
      parts.push(`    </session>`);
    }
    parts.push("  </recent_sessions>");
  }
  
  // Observation index (progressive disclosure)
  if (context.observationIndex.length > 0) {
    parts.push("  <observation_index hint=\"Use mem-search tool to get full details for any observation\">");
    for (const entry of context.observationIndex) {
      parts.push(`    <entry id="${entry.id}" type="${entry.type}" session="${entry.sessionId}">${entry.title}</entry>`);
    }
    parts.push("  </observation_index>");
  }
  
  parts.push("</open_mem_context>");
  
  return parts.join("\n");
}

// Build a compact context for session compaction
export function buildCompactContext(context: ProgressiveContext): string {
  const parts: string[] = [];
  
  parts.push("[open-mem] Memory context:");
  
  if (context.recentSummaries.length > 0) {
    parts.push("\nRecent sessions:");
    for (const summary of context.recentSummaries) {
      parts.push(`- ${summary.summary}`);
    }
  }
  
  if (context.observationIndex.length > 0) {
    parts.push(`\nRecent observations (${context.observationIndex.length} entries):`);
    for (const entry of context.observationIndex) {
      parts.push(`- [${entry.type}] ${entry.title}`);
    }
  }
  
  return parts.join("\n");
}
```

### Step 3: Create context injection hook (`src/hooks/context-inject.ts`)
```typescript
import type { OpenMemConfig } from "../types";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { buildProgressiveContext } from "../context/progressive";
import { buildContextString } from "../context/builder";

export function createContextInjectionHook(
  config: OpenMemConfig,
  observations: ObservationRepository,
  sessions: SessionRepository,
  summaries: SummaryRepository,
  projectPath: string,
) {
  return async (
    input: { sessionID?: string; model: string },
    output: { system: string[] }
  ): Promise<void> => {
    try {
      if (!config.contextInjectionEnabled) return;
      
      // Get recent sessions for this project
      const recentSessions = sessions.getRecent(projectPath, 5);
      if (recentSessions.length === 0) return;
      
      // Get summaries for recent sessions
      const recentSummaries = recentSessions
        .map(s => s.summaryId ? summaries.getBySessionId(s.id) : null)
        .filter((s): s is NonNullable<typeof s> => s !== null);
      
      // Get observation index
      const observationIndex = observations.getIndex(
        projectPath,
        config.maxIndexEntries
      );
      
      if (recentSummaries.length === 0 && observationIndex.length === 0) return;
      
      // Build progressive context within token budget
      const progressiveContext = buildProgressiveContext(
        recentSessions,
        recentSummaries,
        observationIndex,
        config.maxContextTokens,
      );
      
      // Build context string and append to system prompt
      const contextString = buildContextString(progressiveContext);
      output.system.push(contextString);
      
      console.log(
        `[open-mem] Injected context: ${progressiveContext.recentSummaries.length} summaries, ` +
        `${progressiveContext.observationIndex.length} index entries, ` +
        `~${progressiveContext.totalTokens} tokens`
      );
      
    } catch (error) {
      console.error("[open-mem] Context injection error:", error);
      // Never let errors propagate — just skip injection
    }
  };
}
```

### Step 4: Create compaction hook (`src/hooks/compaction.ts`)
```typescript
import type { OpenMemConfig } from "../types";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { buildProgressiveContext } from "../context/progressive";
import { buildCompactContext } from "../context/builder";

export function createCompactionHook(
  config: OpenMemConfig,
  observations: ObservationRepository,
  sessions: SessionRepository,
  summaries: SummaryRepository,
  projectPath: string,
) {
  return async (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string }
  ): Promise<void> => {
    try {
      if (!config.contextInjectionEnabled) return;
      
      const recentSessions = sessions.getRecent(projectPath, 3);
      const recentSummaries = recentSessions
        .map(s => s.summaryId ? summaries.getBySessionId(s.id) : null)
        .filter((s): s is NonNullable<typeof s> => s !== null);
      
      const observationIndex = observations.getIndex(projectPath, 10);
      
      if (recentSummaries.length === 0 && observationIndex.length === 0) return;
      
      const progressiveContext = buildProgressiveContext(
        recentSessions,
        recentSummaries,
        observationIndex,
        Math.floor(config.maxContextTokens / 2),  // Use less budget during compaction
      );
      
      const compactString = buildCompactContext(progressiveContext);
      output.context.push(compactString);
      
      console.log(`[open-mem] Injected compaction context (~${progressiveContext.totalTokens} tokens)`);
      
    } catch (error) {
      console.error("[open-mem] Compaction hook error:", error);
    }
  };
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/context/progressive.ts` | Create | Progressive disclosure logic with token budgeting |
| `src/context/builder.ts` | Create | Context string builder (XML format + compact format) |
| `src/hooks/context-inject.ts` | Create | `experimental.chat.system.transform` handler |
| `src/hooks/compaction.ts` | Create | `experimental.session.compacting` handler |

## Acceptance Criteria
- [ ] `src/context/progressive.ts` exports `buildProgressiveContext` with token budget management
- [ ] Progressive context prioritizes summaries over observation index entries
- [ ] Progressive context respects maxContextTokens budget
- [ ] `src/context/builder.ts` exports `buildContextString` and `buildCompactContext`
- [ ] Context string uses XML format with `<open_mem_context>` wrapper
- [ ] Context string includes hint about mem-search tool for full details
- [ ] Compact context uses plain text format for compaction
- [ ] `src/hooks/context-inject.ts` exports `createContextInjectionHook` factory
- [ ] Context injection hook appends to `output.system` array
- [ ] Context injection hook skips when disabled or no data available
- [ ] Context injection hook never throws
- [ ] `src/hooks/compaction.ts` exports `createCompactionHook` factory
- [ ] Compaction hook uses reduced token budget
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit
```

## Notes
- **UX/DX Review needed**: The context format directly affects how the AI agent perceives and uses past memory. The XML structure, progressive disclosure hints, and token budgeting all impact the quality of context recall.
- The `experimental.chat.system.transform` hook is the best mechanism for context injection — it appends to the system prompt without modifying user messages.
- Progressive disclosure is key to managing token budgets: inject a lightweight index, let the agent request full details via mem-search.
- The compaction hook fires when OpenCode compacts a long conversation — inject a reduced context to maintain memory across compaction boundaries.
- Consider adding a relevance scoring mechanism in the future (e.g., based on file overlap between current session and past observations).
