# 02. Types and Interfaces

## Meta
- **ID**: open-mem-02
- **Feature**: open-mem
- **Phase**: 1
- **Priority**: P1
- **Depends On**: []
- **Effort**: M (2h)
- **Tags**: [implementation, types, foundation]
- **Requires UX/DX Review**: false

## Objective
Define all shared TypeScript types and interfaces for the open-mem plugin, covering observations, sessions, summaries, configuration, queue items, and the OpenCode plugin API contract.

## Context
All subsequent tasks depend on well-defined types. This task creates the single source of truth for data shapes used across the database layer, AI pipeline, hooks, and tools. Types are modeled after claude-mem's observation schema but adapted for OpenCode's plugin API.

**User Requirements**: Reuse claude-mem architectural patterns (observation types, progressive disclosure).

## Deliverables
- `src/types.ts` with all shared types and interfaces

## Implementation Steps

### Step 1: Define observation types
```typescript
// Observation types matching claude-mem's schema
export type ObservationType =
  | "decision"
  | "bugfix"
  | "feature"
  | "refactor"
  | "discovery"
  | "change";

export interface Observation {
  id: string;
  sessionId: string;
  type: ObservationType;
  title: string;
  subtitle: string;
  facts: string[];
  narrative: string;
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
  rawToolOutput: string;       // Original tool output before compression
  toolName: string;            // Which tool generated this
  createdAt: string;           // ISO 8601
  tokenCount: number;          // Estimated tokens for budget management
}

// Index entry for progressive disclosure (lightweight)
export interface ObservationIndex {
  id: string;
  sessionId: string;
  type: ObservationType;
  title: string;
  tokenCount: number;
  createdAt: string;
}
```

### Step 2: Define session types
```typescript
export interface Session {
  id: string;                  // OpenCode session ID
  projectPath: string;         // Project directory
  startedAt: string;           // ISO 8601
  endedAt: string | null;      // ISO 8601 or null if active
  status: "active" | "idle" | "completed";
  observationCount: number;
  summaryId: string | null;    // Reference to session summary
}

export interface SessionSummary {
  id: string;
  sessionId: string;
  summary: string;             // AI-generated session summary
  keyDecisions: string[];
  filesModified: string[];
  concepts: string[];
  createdAt: string;
  tokenCount: number;
}
```

### Step 3: Define queue types
```typescript
export interface PendingMessage {
  id: string;
  sessionId: string;
  toolName: string;
  toolOutput: string;
  callId: string;
  createdAt: string;
  status: "pending" | "processing" | "completed" | "failed";
  retryCount: number;
  error: string | null;
}

export type QueueItem = {
  type: "compress";
  pendingMessageId: string;
  sessionId: string;
  toolName: string;
  toolOutput: string;
  callId: string;
} | {
  type: "summarize";
  sessionId: string;
};
```

### Step 4: Define configuration types
```typescript
export interface OpenMemConfig {
  // Storage
  dbPath: string;                    // Path to SQLite database file
  
  // AI
  apiKey: string | undefined;        // Anthropic API key (env: ANTHROPIC_API_KEY)
  model: string;                     // Model for compression (default: claude-sonnet-4-20250514)
  maxTokensPerCompression: number;   // Max tokens for compression response
  
  // Behavior
  compressionEnabled: boolean;       // Enable/disable AI compression
  contextInjectionEnabled: boolean;  // Enable/disable context injection
  maxContextTokens: number;          // Token budget for injected context
  batchSize: number;                 // Number of observations to process per batch
  batchIntervalMs: number;           // Interval between batch processing
  
  // Filtering
  ignoredTools: string[];            // Tools to ignore (e.g., ["Bash"] for noisy tools)
  minOutputLength: number;           // Minimum tool output length to capture
  
  // Progressive disclosure
  maxIndexEntries: number;           // Max observation index entries in context
  
  // Privacy
  sensitivePatterns: string[];       // Regex patterns to redact from observations
}
```

### Step 5: Define OpenCode plugin API types
```typescript
// OpenCode plugin input shape
export interface PluginInput {
  client: unknown;       // OpenCode client instance
  project: string;       // Project name
  directory: string;     // Project directory path
  worktree: string;      // Git worktree path
  serverUrl: string;     // OpenCode server URL
  $: unknown;            // Shell helper
}

// OpenCode hook types
export interface Hooks {
  "tool.execute.after"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: Record<string, unknown> }
  ) => Promise<void>;
  
  "chat.message"?: (
    input: { sessionID: string; agent?: string; model?: string; messageID?: string },
    output: { message: unknown; parts: unknown[] }
  ) => Promise<void>;
  
  "experimental.chat.system.transform"?: (
    input: { sessionID?: string; model: string },
    output: { system: string[] }
  ) => Promise<void>;
  
  "experimental.session.compacting"?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string }
  ) => Promise<void>;
  
  "event"?: (
    input: { event: OpenCodeEvent }
  ) => Promise<void>;
  
  tools?: ToolDefinition[];
}

export interface OpenCodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  args: Record<string, unknown>;  // Zod schema
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
  sessionID: string;
  abort: AbortSignal;
}

// Plugin type
export type Plugin = (input: PluginInput) => Promise<Hooks>;
```

### Step 6: Define search/query types
```typescript
export interface SearchQuery {
  query: string;
  sessionId?: string;
  type?: ObservationType;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  observation: Observation;
  rank: number;           // FTS5 rank score
  snippet: string;        // FTS5 highlighted snippet
}

export interface TimelineEntry {
  session: Session;
  summary: SessionSummary | null;
  observationCount: number;
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/types.ts` | Create | All shared TypeScript types and interfaces |

## Acceptance Criteria
- [ ] `src/types.ts` exists with all type definitions
- [ ] All observation types match claude-mem schema (decision, bugfix, feature, refactor, discovery, change)
- [ ] Observation interface includes: id, sessionId, type, title, subtitle, facts, narrative, concepts, filesRead, filesModified, rawToolOutput, toolName, createdAt, tokenCount
- [ ] Session interface includes: id, projectPath, startedAt, endedAt, status, observationCount, summaryId
- [ ] PendingMessage interface includes: id, sessionId, toolName, toolOutput, callId, status, retryCount
- [ ] OpenMemConfig interface covers all configuration options
- [ ] Plugin and Hooks types match OpenCode plugin API
- [ ] SearchQuery and SearchResult types defined
- [ ] `bun x tsc --noEmit` passes with no type errors
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Verify file exists and has content
wc -l /Users/clopca/dev/github/open-mem/src/types.ts
```

## Notes
- Types should be exported individually (named exports), not as a default
- Use `string` for dates (ISO 8601 format) rather than `Date` objects for SQLite compatibility
- The OpenCode plugin API types are based on research — they may need adjustment when tested against actual OpenCode
- `ObservationIndex` is a lightweight projection of `Observation` for progressive disclosure
- Consider using branded types for IDs (e.g., `type SessionId = string & { __brand: "SessionId" }`) if desired, but plain strings are fine for v1
