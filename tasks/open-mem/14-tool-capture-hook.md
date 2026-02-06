# 14. Tool Capture Hook

## Meta
- **ID**: open-mem-14
- **Feature**: open-mem
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [open-mem-07, open-mem-13]
- **Effort**: M (2h)
- **Tags**: [implementation, hooks, capture]
- **Requires UX/DX Review**: false

## Objective
Implement the `tool.execute.after` hook handler that captures tool execution outputs and enqueues them for AI compression, plus the `event` handler for session lifecycle events.

## Context
This is the primary data capture mechanism. Every time a tool executes in OpenCode (Read, Write, Edit, Bash, Glob, Grep, etc.), the `tool.execute.after` hook fires with the tool name and output. This handler filters, validates, and enqueues the output for asynchronous processing.

**User Requirements**: Capture via `tool.execute.after` events. Automatic observation capture on tool executions.

## Deliverables
- `src/hooks/tool-capture.ts` — `tool.execute.after` handler
- `src/hooks/session-events.ts` — `event` handler for session lifecycle

## Implementation Steps

### Step 1: Create tool capture hook (`src/hooks/tool-capture.ts`)
```typescript
import type { OpenMemConfig } from "../types";
import type { QueueProcessor } from "../queue/processor";
import type { SessionRepository } from "../db/sessions";

export function createToolCaptureHook(
  config: OpenMemConfig,
  queue: QueueProcessor,
  sessions: SessionRepository,
  projectPath: string,
) {
  return async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: Record<string, unknown> }
  ): Promise<void> => {
    try {
      const { tool, sessionID, callID } = input;
      const { output: toolOutput } = output;
      
      // Filter: skip ignored tools
      if (config.ignoredTools.includes(tool)) {
        return;
      }
      
      // Filter: skip empty or very short outputs
      if (!toolOutput || toolOutput.length < config.minOutputLength) {
        return;
      }
      
      // Filter: redact sensitive patterns (replace matches, don't skip entire output)
      let processedOutput = toolOutput;
      if (config.sensitivePatterns.length > 0) {
        for (const pattern of config.sensitivePatterns) {
          try {
            processedOutput = processedOutput.replace(new RegExp(pattern, 'g'), '[REDACTED]');
          } catch {
            // Invalid regex pattern, skip it
          }
        }
      }
      
      // Ensure session exists
      sessions.getOrCreate(sessionID, projectPath);
      
      // Enqueue for processing
      queue.enqueue(sessionID, tool, processedOutput, callID);
      
      console.log(`[open-mem] Captured ${tool} output (${processedOutput.length} chars) for session ${sessionID}`);
      
    } catch (error) {
      // Never let hook errors propagate to OpenCode
      console.error("[open-mem] Tool capture error:", error);
    }
  };
}
```

### Step 2: Create session event handler (`src/hooks/session-events.ts`)
```typescript
import type { OpenMemConfig, OpenCodeEvent } from "../types";
import type { QueueProcessor } from "../queue/processor";
import type { SessionRepository } from "../db/sessions";

export function createEventHandler(
  config: OpenMemConfig,
  queue: QueueProcessor,
  sessions: SessionRepository,
  projectPath: string,
) {
  return async (input: { event: OpenCodeEvent }): Promise<void> => {
    try {
      const { event } = input;
      
      switch (event.type) {
        case "session.created": {
          const sessionId = event.properties.sessionID as string;
          if (sessionId) {
            sessions.getOrCreate(sessionId, projectPath);
            console.log(`[open-mem] Session created: ${sessionId}`);
          }
          break;
        }
        
        case "session.idle": {
          // Trigger batch processing when session goes idle
          const sessionId = event.properties.sessionID as string;
          console.log(`[open-mem] Session idle: ${sessionId}, processing queue`);
          
          // Process pending observations
          await queue.processBatch();
          
          // Update session status
          if (sessionId) {
            sessions.updateStatus(sessionId, "idle");
          }
          break;
        }
        
        case "session.completed":
        case "session.ended": {
          const sessionId = event.properties.sessionID as string;
          if (sessionId) {
            console.log(`[open-mem] Session ending: ${sessionId}`);
            
            // Process any remaining pending observations
            await queue.processBatch();
            
            // Generate session summary
            await queue.summarizeSession(sessionId);
            
            // Mark session as completed
            sessions.markCompleted(sessionId);
          }
          break;
        }
        
        default:
          // Ignore other events
          break;
      }
    } catch (error) {
      console.error("[open-mem] Event handler error:", error);
    }
  };
}
```

### Step 3: Add chat.message handler for session tracking
```typescript
// src/hooks/chat-message.ts (optional — may not be needed if session.created event works)
export function createChatMessageHook(
  sessions: SessionRepository,
  projectPath: string,
) {
  return async (
    input: { sessionID: string; agent?: string; model?: string; messageID?: string },
    output: { message: unknown; parts: unknown[] }
  ): Promise<void> => {
    try {
      // Ensure session exists on first message
      sessions.getOrCreate(input.sessionID, projectPath);
    } catch (error) {
      console.error("[open-mem] Chat message hook error:", error);
    }
  };
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/hooks/tool-capture.ts` | Create | `tool.execute.after` handler with filtering and enqueuing |
| `src/hooks/session-events.ts` | Create | `event` handler for session lifecycle (created, idle, ended) |
| `src/hooks/chat-message.ts` | Create | `chat.message` handler for session tracking (optional) |

## Acceptance Criteria
- [ ] `src/hooks/tool-capture.ts` exports `createToolCaptureHook` factory function
- [ ] Tool capture hook filters out ignored tools
- [ ] Tool capture hook filters out outputs shorter than minOutputLength
- [ ] Tool capture hook redacts content matching sensitive patterns with [REDACTED]
- [ ] Tool capture hook ensures session exists before enqueuing
- [ ] Tool capture hook enqueues valid outputs to the queue processor
- [ ] Tool capture hook never throws (errors are caught and logged)
- [ ] `src/hooks/session-events.ts` exports `createEventHandler` factory function
- [ ] Event handler processes `session.created` events (creates session)
- [ ] Event handler processes `session.idle` events (triggers batch processing)
- [ ] Event handler processes `session.completed`/`session.ended` events (summarize + complete)
- [ ] Event handler never throws (errors are caught and logged)
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit
```

## Notes
- **Critical**: Hook handlers must NEVER throw errors — they should catch everything and log. An unhandled error in a hook could crash OpenCode.
- The tool capture hook is the highest-frequency hook — it fires on every tool execution. Keep it lightweight (just enqueue, don't process).
- Session events may vary by OpenCode version — the exact event types (`session.created`, `session.idle`, etc.) should be verified against the actual OpenCode runtime.
- The `chat.message` hook is a backup for session tracking in case `session.created` events aren't reliable.
- Consider adding a debounce on `session.idle` processing to avoid processing too frequently if idle events fire rapidly.
