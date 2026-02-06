# 18. Plugin Entry Point

## Meta
- **ID**: open-mem-18
- **Feature**: open-mem
- **Phase**: 5
- **Priority**: P1
- **Depends On**: [open-mem-14, open-mem-15, open-mem-17]
- **Effort**: M (2-3h)
- **Tags**: [implementation, integration, plugin]
- **Requires UX/DX Review**: true

## Objective
Wire all components together in the plugin entry point: initialize database, create repositories, set up AI services, register hooks, register tools, and handle plugin lifecycle.

## Context
This is the final integration task that connects all the pieces. The plugin entry point receives the OpenCode plugin input (client, project, directory) and returns a Hooks object with all registered handlers and tools. It's responsible for initialization, dependency injection, and graceful shutdown.

**User Requirements**: OpenCode Plugin (Approach 2). Standalone npm-publishable package.

## Deliverables
- `src/index.ts` — Complete plugin entry point with all wiring

## Implementation Steps

### Step 1: Import all modules
```typescript
import type { PluginInput, Hooks, OpenMemConfig } from "./types";
import { resolveConfig, validateConfig, ensureDbDirectory } from "./config";
import { createDatabase, Database } from "./db/database";
import { initializeSchema } from "./db/schema";
import { SessionRepository } from "./db/sessions";
import { ObservationRepository } from "./db/observations";
import { SummaryRepository } from "./db/summaries";
import { PendingMessageRepository } from "./db/pending";
import { ObservationCompressor } from "./ai/compressor";
import { SessionSummarizer } from "./ai/summarizer";
import { QueueProcessor } from "./queue/processor";
import { createToolCaptureHook } from "./hooks/tool-capture";
import { createEventHandler } from "./hooks/session-events";
import { createChatMessageHook } from "./hooks/chat-message";
import { createContextInjectionHook } from "./hooks/context-inject";
import { createCompactionHook } from "./hooks/compaction";
import { createSearchTool } from "./tools/search";
import { createSaveTool } from "./tools/save";
import { createTimelineTool } from "./tools/timeline";
```

### Step 2: Implement plugin factory
```typescript
export default async function plugin(
  input: PluginInput
): Promise<Hooks> {
  const { project, directory } = input;
  
  console.log(`[open-mem] Initializing for project: ${project} at ${directory}`);
  
  // 1. Resolve configuration
  const config = resolveConfig(directory);
  const errors = validateConfig(config);
  
  if (errors.length > 0) {
    console.warn("[open-mem] Configuration warnings:");
    errors.forEach(e => console.warn(`  - ${e}`));
  }
  
  // 2. Ensure database directory exists
  await ensureDbDirectory(config);
  
  // 3. Initialize database
  const db = createDatabase(config);
  initializeSchema(db);
  console.log(`[open-mem] Database initialized at ${config.dbPath}`);
  
  // 4. Create repositories
  const sessionRepo = new SessionRepository(db);
  const observationRepo = new ObservationRepository(db);
  const summaryRepo = new SummaryRepository(db);
  const pendingRepo = new PendingMessageRepository(db);
  
  // 5. Create AI services
  const compressor = new ObservationCompressor(config);
  const summarizer = new SessionSummarizer(config);
  
  // 6. Create queue processor
  const queue = new QueueProcessor(
    config,
    compressor,
    summarizer,
    pendingRepo,
    observationRepo,
    sessionRepo,
    summaryRepo,
  );
  
  // Start timer-based processing
  queue.start();
  
  // 7. Create hooks
  const toolCaptureHook = createToolCaptureHook(config, queue, sessionRepo, directory);
  const eventHandler = createEventHandler(config, queue, sessionRepo, directory);
  const chatMessageHook = createChatMessageHook(sessionRepo, directory);
  const contextInjectionHook = createContextInjectionHook(
    config, observationRepo, sessionRepo, summaryRepo, directory
  );
  const compactionHook = createCompactionHook(
    config, observationRepo, sessionRepo, summaryRepo, directory
  );
  
  // 8. Create tools
  const searchTool = createSearchTool(observationRepo, summaryRepo);
  const saveTool = createSaveTool(observationRepo, sessionRepo, directory);
  const timelineTool = createTimelineTool(sessionRepo, summaryRepo, observationRepo, directory);
  
  console.log("[open-mem] Plugin initialized successfully");
  console.log(`[open-mem] Compression: ${config.compressionEnabled ? "enabled" : "disabled"}`);
  console.log(`[open-mem] Context injection: ${config.contextInjectionEnabled ? "enabled" : "disabled"}`);
  
  // 9. Return hooks object
  return {
    "tool.execute.after": toolCaptureHook,
    "chat.message": chatMessageHook,
    "event": eventHandler,
    "experimental.chat.system.transform": contextInjectionHook,
    "experimental.session.compacting": compactionHook,
    tools: [searchTool, saveTool, timelineTool],
  };
}
```

### Step 3: Add cleanup/shutdown handling
```typescript
// Register cleanup on process exit
process.on("beforeExit", () => {
  console.log("[open-mem] Shutting down...");
  queue.stop();
  db.close();
});

// Also handle SIGTERM/SIGINT
const cleanup = () => {
  queue.stop();
  db.close();
};
process.on("SIGTERM", cleanup);
process.on("SIGINT", cleanup);
```

### Step 4: Export types for consumers
```typescript
// Re-export types that consumers might need
export type { OpenMemConfig, Observation, Session, SessionSummary } from "./types";
export { resolveConfig, getDefaultConfig } from "./config";
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/index.ts` | Modify | Complete plugin entry point with all wiring, lifecycle, exports |

## Acceptance Criteria
- [ ] `src/index.ts` exports a default plugin function matching OpenCode's Plugin type
- [ ] Plugin initializes database on load
- [ ] Plugin creates all repositories
- [ ] Plugin creates AI services (compressor, summarizer)
- [ ] Plugin creates and starts queue processor
- [ ] Plugin registers `tool.execute.after` hook
- [ ] Plugin registers `chat.message` hook
- [ ] Plugin registers `event` hook
- [ ] Plugin registers `experimental.chat.system.transform` hook
- [ ] Plugin registers `experimental.session.compacting` hook
- [ ] Plugin registers 3 custom tools: mem-search, mem-save, mem-timeline
- [ ] Plugin handles shutdown gracefully (stops queue, closes DB)
- [ ] Plugin logs initialization status
- [ ] Plugin re-exports key types for consumers
- [ ] Configuration warnings are logged but don't prevent startup
- [ ] `bun x tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Build
cd /Users/clopca/dev/github/open-mem && bun run build

# Verify exports
cd /Users/clopca/dev/github/open-mem && bun -e "
  const plugin = require('./src/index.ts');
  console.log('Default export type:', typeof plugin.default);
  console.log('Has resolveConfig:', typeof plugin.resolveConfig);
"

# Smoke test — initialize plugin
cd /Users/clopca/dev/github/open-mem && bun -e "
  const plugin = require('./src/index.ts').default;
  plugin({
    client: {},
    project: 'test-project',
    directory: '/tmp/open-mem-smoke-test',
    worktree: '/tmp/open-mem-smoke-test',
    serverUrl: 'http://localhost:3000',
  }).then(hooks => {
    console.log('Hooks registered:', Object.keys(hooks));
    console.log('Tools:', hooks.tools?.map(t => t.name));
    console.log('Plugin smoke test passed');
    process.exit(0);
  }).catch(err => {
    console.error('Plugin smoke test failed:', err);
    process.exit(1);
  });
"
```

## Notes
- **UX/DX Review needed**: The plugin initialization experience (logging, error messages, configuration) affects developer experience when setting up open-mem.
- The plugin function is async because `ensureDbDirectory` is async
- Shutdown handling is important — unclosed SQLite connections can corrupt the database
- Consider adding a `--verbose` or `OPEN_MEM_DEBUG` env var for detailed logging
- The plugin should work even without an API key — just without AI compression
- Re-exporting types allows consumers to use open-mem's types in their own code
