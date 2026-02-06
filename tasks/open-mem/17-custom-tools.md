# 17. Custom Tools

## Meta
- **ID**: open-mem-17
- **Feature**: open-mem
- **Phase**: 5
- **Priority**: P1
- **Depends On**: [open-mem-07, open-mem-15]
- **Effort**: M (2-3h)
- **Tags**: [implementation, tools, search, mcp]
- **Requires UX/DX Review**: true

## Objective
Implement three custom tools for OpenCode: `mem-search` (full-text search across observations), `mem-save` (manually save an observation), and `mem-timeline` (view session history).

## Context
Custom tools allow the AI agent to actively query the memory system. While context injection provides passive recall (automatic), custom tools provide active recall (on-demand). This is the "search via custom tools" requirement. Tools use OpenCode's `tool()` API with Zod schemas for argument validation.

**User Requirements**: Search via custom tools or MCP.

## Deliverables
- `src/tools/search.ts` — mem-search custom tool
- `src/tools/save.ts` — mem-save custom tool
- `src/tools/timeline.ts` — mem-timeline custom tool

## Implementation Steps

### Step 1: Create mem-search tool (`src/tools/search.ts`)
```typescript
import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SummaryRepository } from "../db/summaries";
import type { ToolDefinition } from "../types";

export function createSearchTool(
  observations: ObservationRepository,
  summaries: SummaryRepository,
): ToolDefinition {
  return {
    name: "mem-search",
    description: `Search through past coding session observations and memories.
Use this tool to find relevant context from previous sessions, including:
- Past decisions and their rationale
- Bug fixes and their solutions
- Code patterns and discoveries
- File modification history
- Concept-based knowledge retrieval

Supports full-text search with FTS5. You can search by keywords, file paths, concepts, or observation types.`,
    args: {
      query: z.string().describe("Search query (supports keywords, phrases, file paths)"),
      type: z.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
        .optional()
        .describe("Filter by observation type"),
      limit: z.number().min(1).max(50).default(10)
        .describe("Maximum number of results to return"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const query = args.query as string;
        const type = args.type as string | undefined;
        const limit = (args.limit as number) || 10;
        
        // Search observations
        const results = observations.search({
          query,
          type: type as any,
          limit,
        });
        
        if (results.length === 0) {
          // Also search summaries
          const summaryResults = summaries.search(query, limit);
          if (summaryResults.length === 0) {
            return "No matching observations or session summaries found.";
          }
          
          return formatSummaryResults(summaryResults);
        }
        
        return formatSearchResults(results);
      } catch (error) {
        return `Search error: ${error}`;
      }
    },
  };
}

function formatSearchResults(results: any[]): string {
  const lines: string[] = [`Found ${results.length} observation(s):\n`];
  
  for (const result of results) {
    const obs = result.observation;
    lines.push(`## [${obs.type.toUpperCase()}] ${obs.title}`);
    if (obs.subtitle) lines.push(`*${obs.subtitle}*`);
    lines.push(`\n${obs.narrative}`);
    
    if (obs.facts.length > 0) {
      lines.push("\n**Facts:**");
      obs.facts.forEach((f: string) => lines.push(`- ${f}`));
    }
    
    if (obs.concepts.length > 0) {
      lines.push(`\n**Concepts:** ${obs.concepts.join(", ")}`);
    }
    
    if (obs.filesModified.length > 0) {
      lines.push(`**Files modified:** ${obs.filesModified.join(", ")}`);
    }
    
    if (obs.filesRead.length > 0) {
      lines.push(`**Files read:** ${obs.filesRead.join(", ")}`);
    }
    
    lines.push(`\n*Session: ${obs.sessionId} | ${obs.createdAt}*`);
    lines.push("---");
  }
  
  return lines.join("\n");
}

function formatSummaryResults(summaries: any[]): string {
  const lines: string[] = [`Found ${summaries.length} session summary(ies):\n`];
  
  for (const summary of summaries) {
    lines.push(`## Session: ${summary.sessionId}`);
    lines.push(summary.summary);
    if (summary.keyDecisions.length > 0) {
      lines.push("\n**Key decisions:**");
      summary.keyDecisions.forEach((d: string) => lines.push(`- ${d}`));
    }
    lines.push("---");
  }
  
  return lines.join("\n");
}
```

### Step 2: Create mem-save tool (`src/tools/save.ts`)
```typescript
import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { ToolDefinition, ObservationType } from "../types";
import { estimateTokens } from "../ai/parser";

export function createSaveTool(
  observations: ObservationRepository,
  sessions: SessionRepository,
  projectPath: string,
): ToolDefinition {
  return {
    name: "mem-save",
    description: `Manually save an observation to memory.
Use this tool to explicitly record important decisions, discoveries, or context that should be remembered across sessions.
This is useful for saving information that wasn't captured automatically from tool executions.`,
    args: {
      title: z.string().describe("Brief title for the observation (max 80 chars)"),
      type: z.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
        .describe("Type of observation"),
      narrative: z.string().describe("Detailed description of what to remember"),
      concepts: z.array(z.string()).optional()
        .describe("Related concepts/tags for searchability"),
      files: z.array(z.string()).optional()
        .describe("Related file paths"),
    },
    execute: async (args: Record<string, unknown>, context: { sessionID: string }) => {
      try {
        const title = args.title as string;
        const type = args.type as ObservationType;
        const narrative = args.narrative as string;
        const concepts = (args.concepts as string[]) || [];
        const files = (args.files as string[]) || [];
        
        // Ensure session exists
        sessions.getOrCreate(context.sessionID, projectPath);
        
        const observation = observations.create({
          sessionId: context.sessionID,
          type,
          title,
          subtitle: "",
          facts: [],
          narrative,
          concepts,
          filesRead: [],
          filesModified: files,
          rawToolOutput: `[Manual save] ${narrative}`,
          toolName: "mem-save",
          tokenCount: estimateTokens(title + narrative),
        });
        
        sessions.incrementObservationCount(context.sessionID);
        
        return `Saved observation: [${type}] "${title}" (ID: ${observation.id})`;
      } catch (error) {
        return `Save error: ${error}`;
      }
    },
  };
}
```

### Step 3: Create mem-timeline tool (`src/tools/timeline.ts`)
```typescript
import { z } from "zod";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import type { ObservationRepository } from "../db/observations";
import type { ToolDefinition } from "../types";

export function createTimelineTool(
  sessions: SessionRepository,
  summaries: SummaryRepository,
  observations: ObservationRepository,
  projectPath: string,
): ToolDefinition {
  return {
    name: "mem-timeline",
    description: `View a timeline of past coding sessions for this project.
Shows recent sessions with their summaries, observation counts, and key decisions.
Use this to understand the history of work done on this project.`,
    args: {
      limit: z.number().min(1).max(20).default(5)
        .describe("Number of recent sessions to show"),
      sessionId: z.string().optional()
        .describe("Show details for a specific session ID"),
    },
    execute: async (args: Record<string, unknown>) => {
      try {
        const limit = (args.limit as number) || 5;
        const sessionId = args.sessionId as string | undefined;
        
        if (sessionId) {
          return formatSessionDetail(sessionId, sessions, summaries, observations);
        }
        
        const recentSessions = sessions.getRecent(projectPath, limit);
        
        if (recentSessions.length === 0) {
          return "No past sessions found for this project.";
        }
        
        const lines: string[] = [`# Session Timeline (${recentSessions.length} sessions)\n`];
        
        for (const session of recentSessions) {
          const summary = session.summaryId
            ? summaries.getBySessionId(session.id)
            : null;
          
          lines.push(`## Session: ${session.id}`);
          lines.push(`- **Started**: ${session.startedAt}`);
          lines.push(`- **Status**: ${session.status}`);
          lines.push(`- **Observations**: ${session.observationCount}`);
          
          if (summary) {
            lines.push(`- **Summary**: ${summary.summary}`);
            if (summary.keyDecisions.length > 0) {
              lines.push(`- **Key decisions**: ${summary.keyDecisions.join("; ")}`);
            }
          }
          
          lines.push("");
        }
        
        return lines.join("\n");
      } catch (error) {
        return `Timeline error: ${error}`;
      }
    },
  };
}

function formatSessionDetail(
  sessionId: string,
  sessions: SessionRepository,
  summaries: SummaryRepository,
  observations: ObservationRepository,
): string {
  const session = sessions.getById(sessionId);
  if (!session) return `Session ${sessionId} not found.`;
  
  const summary = session.summaryId ? summaries.getBySessionId(sessionId) : null;
  const obs = observations.getBySession(sessionId);
  
  const lines: string[] = [`# Session Detail: ${sessionId}\n`];
  lines.push(`- **Started**: ${session.startedAt}`);
  lines.push(`- **Ended**: ${session.endedAt || "Active"}`);
  lines.push(`- **Status**: ${session.status}`);
  lines.push(`- **Observations**: ${session.observationCount}`);
  
  if (summary) {
    lines.push(`\n## Summary\n${summary.summary}`);
    if (summary.keyDecisions.length > 0) {
      lines.push("\n**Key decisions:**");
      summary.keyDecisions.forEach(d => lines.push(`- ${d}`));
    }
  }
  
  if (obs.length > 0) {
    lines.push("\n## Observations");
    for (const o of obs) {
      lines.push(`\n### [${o.type.toUpperCase()}] ${o.title}`);
      lines.push(o.narrative);
      if (o.concepts.length > 0) {
        lines.push(`*Concepts: ${o.concepts.join(", ")}*`);
      }
    }
  }
  
  return lines.join("\n");
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/tools/search.ts` | Create | mem-search tool with FTS5 search |
| `src/tools/save.ts` | Create | mem-save tool for manual observation saving |
| `src/tools/timeline.ts` | Create | mem-timeline tool for session history |

## Acceptance Criteria
- [ ] `src/tools/search.ts` exports `createSearchTool` factory
- [ ] mem-search accepts query, optional type filter, and limit
- [ ] mem-search returns formatted observation results with all fields
- [ ] mem-search falls back to summary search when no observations match
- [ ] mem-search handles errors gracefully (returns error string, doesn't throw)
- [ ] `src/tools/save.ts` exports `createSaveTool` factory
- [ ] mem-save accepts title, type, narrative, optional concepts and files
- [ ] mem-save creates observation in database and increments session count
- [ ] `src/tools/timeline.ts` exports `createTimelineTool` factory
- [ ] mem-timeline shows recent sessions with summaries
- [ ] mem-timeline supports drilling into a specific session
- [ ] All tools use Zod schemas for argument validation
- [ ] All tools return string results (OpenCode tool contract)
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit
```

## Notes
- **UX/DX Review needed**: Tool descriptions and output formatting directly affect how the AI agent uses these tools. Clear descriptions and well-formatted output improve recall quality.
- All tool `execute` functions must return strings — this is the OpenCode tool contract
- Tool errors should return error messages as strings, never throw
- The `context.sessionID` parameter in `execute` provides the current session ID
- Consider adding a `mem-forget` tool in the future for removing specific observations
- Zod schemas provide automatic argument validation — invalid args will be rejected by OpenCode before reaching the execute function
