# 13. Queue Processor

## Meta
- **ID**: open-mem-13
- **Feature**: open-mem
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [open-mem-07, open-mem-10]
- **Effort**: M (2-3h)
- **Tags**: [implementation, queue, processing]
- **Requires UX/DX Review**: false

## Objective
Implement the in-memory queue with SQLite persistence for asynchronous observation processing, including batch compression on session idle events.

## Context
Tool executions happen frequently and synchronously. Rather than blocking on AI compression for each one, observations are enqueued as pending messages in SQLite and processed asynchronously. The queue processor runs on `session.idle` events or on a timer, compressing pending observations in batches.

**User Requirements**: Reuse claude-mem architectural patterns (queue-based processing). Batch processing on `session.idle`.

## Deliverables
- `src/queue/types.ts` — Queue item types (may already be in types.ts)
- `src/queue/processor.ts` — Queue processing loop with batch compression

## Implementation Steps

### Step 1: Define queue processor class
```typescript
import type { OpenMemConfig, QueueItem } from "../types";
import type { ObservationCompressor } from "../ai/compressor";
import type { SessionSummarizer } from "../ai/summarizer";
import type { ObservationRepository, PendingMessageRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { estimateTokens } from "../ai/parser";

export class QueueProcessor {
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  
  constructor(
    private config: OpenMemConfig,
    private compressor: ObservationCompressor,
    private summarizer: SessionSummarizer,
    private pendingRepo: PendingMessageRepository,
    private observationRepo: ObservationRepository,
    private sessionRepo: SessionRepository,
    private summaryRepo: SummaryRepository,
  ) {}
}
```

### Step 2: Implement batch processing
```typescript
async processBatch(): Promise<number> {
  if (this.processing) {
    console.log("[open-mem] Queue already processing, skipping");
    return 0;
  }
  
  this.processing = true;
  let processed = 0;
  
  try {
    // Reset any stale processing items
    this.pendingRepo.resetStale(5);
    
    // Get pending items
    const pending = this.pendingRepo.getPending(this.config.batchSize);
    if (pending.length === 0) {
      return 0;
    }
    
    console.log(`[open-mem] Processing ${pending.length} pending observations`);
    
    for (const item of pending) {
      try {
        this.pendingRepo.markProcessing(item.id);
        
        // Compress with AI
        const parsed = await this.compressor.compress(
          item.toolName,
          item.toolOutput,
          item.sessionId,
        );
        
        // Use fallback if AI compression fails
        const observation = parsed || this.compressor.createFallbackObservation(
          item.toolName,
          item.toolOutput,
        );
        
        // Store the observation
        this.observationRepo.create({
          sessionId: item.sessionId,
          type: observation.type,
          title: observation.title,
          subtitle: observation.subtitle,
          facts: observation.facts,
          narrative: observation.narrative,
          concepts: observation.concepts,
          filesRead: observation.filesRead,
          filesModified: observation.filesModified,
          rawToolOutput: item.toolOutput,
          toolName: item.toolName,
          tokenCount: estimateTokens(
            observation.title + observation.narrative + observation.facts.join(" ")
          ),
        });
        
        // Update session observation count
        this.sessionRepo.incrementObservationCount(item.sessionId);
        
        // Mark as completed
        this.pendingRepo.markCompleted(item.id);
        processed++;
        
      } catch (error) {
        console.error(`[open-mem] Failed to process item ${item.id}:`, error);
        this.pendingRepo.markFailed(item.id, String(error));
      }
    }
    
    console.log(`[open-mem] Processed ${processed}/${pending.length} observations`);
    return processed;
    
  } finally {
    this.processing = false;
  }
}
```

### Step 3: Implement session summarization trigger
```typescript
async summarizeSession(sessionId: string): Promise<void> {
  const observations = this.observationRepo.getBySession(sessionId);
  
  if (!this.summarizer.shouldSummarize(observations.length)) {
    console.log(`[open-mem] Session ${sessionId} has too few observations to summarize`);
    return;
  }
  
  // Check if summary already exists
  const existing = this.summaryRepo.getBySessionId(sessionId);
  if (existing) {
    console.log(`[open-mem] Session ${sessionId} already has a summary`);
    return;
  }
  
  console.log(`[open-mem] Summarizing session ${sessionId} with ${observations.length} observations`);
  
  const parsed = await this.summarizer.summarize(sessionId, observations);
  if (!parsed) return;
  
  const summary = this.summaryRepo.create({
    sessionId,
    summary: parsed.summary,
    keyDecisions: parsed.keyDecisions,
    filesModified: parsed.filesModified,
    concepts: parsed.concepts,
    tokenCount: estimateTokens(parsed.summary),
  });
  
  // Link summary to session
  this.sessionRepo.setSummary(sessionId, summary.id);
  console.log(`[open-mem] Created summary for session ${sessionId}`);
}
```

### Step 4: Implement timer-based processing
```typescript
start(): void {
  if (this.timer) return;
  
  this.timer = setInterval(async () => {
    try {
      await this.processBatch();
    } catch (error) {
      console.error("[open-mem] Timer batch processing error:", error);
    }
  }, this.config.batchIntervalMs);
  
  console.log(`[open-mem] Queue processor started (interval: ${this.config.batchIntervalMs}ms)`);
}

stop(): void {
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
    console.log("[open-mem] Queue processor stopped");
  }
}

get isRunning(): boolean {
  return this.timer !== null;
}

get isProcessing(): boolean {
  return this.processing;
}
```

### Step 5: Implement enqueue helper
```typescript
// Convenience method to enqueue a new pending message
enqueue(sessionId: string, toolName: string, toolOutput: string, callId: string): void {
  this.pendingRepo.create({
    sessionId,
    toolName,
    toolOutput,
    callId,
  });
}

// Get queue stats
getStats(): { pending: number; processing: boolean } {
  const pending = this.pendingRepo.getPending(1000);
  return {
    pending: pending.length,
    processing: this.processing,
  };
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/queue/types.ts` | Create | Queue-specific types (if not already in types.ts) |
| `src/queue/processor.ts` | Create | QueueProcessor class with batch processing, summarization, timer |

## Acceptance Criteria
- [ ] `src/queue/processor.ts` exports `QueueProcessor` class
- [ ] `processBatch()` fetches pending messages and compresses them with AI
- [ ] `processBatch()` uses fallback when AI compression fails
- [ ] `processBatch()` stores compressed observations in the database
- [ ] `processBatch()` updates session observation counts
- [ ] `processBatch()` marks items as completed/failed appropriately
- [ ] `processBatch()` prevents concurrent processing (mutex via `processing` flag)
- [ ] `processBatch()` resets stale processing items before fetching new ones
- [ ] `summarizeSession()` generates and stores session summaries
- [ ] `summarizeSession()` skips sessions with too few observations
- [ ] `summarizeSession()` skips sessions that already have summaries
- [ ] `start()` begins timer-based batch processing
- [ ] `stop()` cleanly stops the timer
- [ ] `enqueue()` creates pending messages in the database
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit
```

## Notes
- The `processing` flag is a simple mutex — sufficient for single-process plugins
- Timer-based processing is a safety net; primary trigger is `session.idle` events
- Consider adding a `drain()` method that processes all pending items (useful for session end)
- The queue processor is the central orchestrator — it ties together the DB layer and AI pipeline
- Error handling is per-item: one failed compression doesn't block the rest of the batch
