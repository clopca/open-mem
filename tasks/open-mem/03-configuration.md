# 03. Configuration

## Meta
- **ID**: open-mem-03
- **Feature**: open-mem
- **Phase**: 1
- **Priority**: P1
- **Depends On**: [open-mem-01, open-mem-02]
- **Effort**: S (1-1.5h)
- **Tags**: [implementation, configuration]
- **Requires UX/DX Review**: false

## Objective
Implement configuration management for open-mem with sensible defaults, environment variable overrides, and runtime configuration support.

## Context
The plugin needs configurable behavior for database path, AI model, token budgets, filtering, and privacy settings. Configuration should work out-of-the-box with zero setup but allow customization via environment variables or programmatic overrides.

**User Requirements**: Standalone npm-publishable package (must work with minimal config).

## Deliverables
- `src/config.ts` with configuration loading, defaults, and validation

## Implementation Steps

### Step 1: Define default configuration
```typescript
import type { OpenMemConfig } from "./types";

const DEFAULT_CONFIG: OpenMemConfig = {
  // Storage — default to project-local .open-mem directory
  dbPath: ".open-mem/memory.db",
  
  // AI
  apiKey: undefined,  // Falls back to ANTHROPIC_API_KEY env var
  model: "claude-sonnet-4-20250514",
  maxTokensPerCompression: 1024,
  
  // Behavior
  compressionEnabled: true,
  contextInjectionEnabled: true,
  maxContextTokens: 4000,
  batchSize: 5,
  batchIntervalMs: 30_000,  // 30 seconds
  
  // Filtering
  ignoredTools: [],
  minOutputLength: 50,
  
  // Progressive disclosure
  maxIndexEntries: 20,
  
  // Privacy
  sensitivePatterns: [],
  
  // Data retention
  retentionDays: 90,              // Keep 90 days by default
  maxDatabaseSizeMb: 500,         // 500MB max by default
  
  // Logging
  logLevel: "warn" as const,
};
```

### Step 2: Implement environment variable loading
```typescript
function loadFromEnv(): Partial<OpenMemConfig> {
  const env: Partial<OpenMemConfig> = {};
  
  if (process.env.OPEN_MEM_DB_PATH) env.dbPath = process.env.OPEN_MEM_DB_PATH;
  if (process.env.ANTHROPIC_API_KEY) env.apiKey = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPEN_MEM_MODEL) env.model = process.env.OPEN_MEM_MODEL;
  if (process.env.OPEN_MEM_MAX_CONTEXT_TOKENS) env.maxContextTokens = parseInt(process.env.OPEN_MEM_MAX_CONTEXT_TOKENS, 10);
  if (process.env.OPEN_MEM_COMPRESSION === "false") env.compressionEnabled = false;
  if (process.env.OPEN_MEM_CONTEXT_INJECTION === "false") env.contextInjectionEnabled = false;
  if (process.env.OPEN_MEM_IGNORED_TOOLS) env.ignoredTools = process.env.OPEN_MEM_IGNORED_TOOLS.split(",").map(s => s.trim());
  if (process.env.OPEN_MEM_BATCH_SIZE) env.batchSize = parseInt(process.env.OPEN_MEM_BATCH_SIZE, 10);
  if (process.env.OPEN_MEM_RETENTION_DAYS) env.retentionDays = parseInt(process.env.OPEN_MEM_RETENTION_DAYS, 10);
  if (process.env.OPEN_MEM_LOG_LEVEL) env.logLevel = process.env.OPEN_MEM_LOG_LEVEL as any;
  
  return env;
}
```

### Step 3: Implement config resolution
```typescript
export function resolveConfig(
  projectDir: string,
  overrides?: Partial<OpenMemConfig>
): OpenMemConfig {
  const envConfig = loadFromEnv();
  
  const config: OpenMemConfig = {
    ...DEFAULT_CONFIG,
    ...envConfig,
    ...overrides,
  };
  
  // Resolve relative dbPath against project directory
  if (!config.dbPath.startsWith("/")) {
    config.dbPath = `${projectDir}/${config.dbPath}`;
  }
  
  // Ensure API key is available (from config or env)
  if (!config.apiKey) {
    config.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  
  return config;
}
```

### Step 4: Implement config validation
```typescript
export function validateConfig(config: OpenMemConfig): string[] {
  const errors: string[] = [];
  
  if (config.compressionEnabled && !config.apiKey) {
    errors.push("AI compression enabled but no ANTHROPIC_API_KEY found. Set ANTHROPIC_API_KEY env var or disable compression.");
  }
  
  if (config.maxContextTokens < 500) {
    errors.push("maxContextTokens must be at least 500");
  }
  
  if (config.batchSize < 1) {
    errors.push("batchSize must be at least 1");
  }
  
  if (config.minOutputLength < 0) {
    errors.push("minOutputLength must be non-negative");
  }
  
  return errors;
}
```

### Step 5: Export convenience functions
```typescript
export function getDefaultConfig(): OpenMemConfig {
  return { ...DEFAULT_CONFIG };
}

// Ensure the database directory exists
export async function ensureDbDirectory(config: OpenMemConfig): Promise<void> {
  const dir = config.dbPath.substring(0, config.dbPath.lastIndexOf("/"));
  await Bun.write(Bun.file(`${dir}/.gitkeep`), "");
  // Or use: import { mkdir } from "node:fs/promises"; await mkdir(dir, { recursive: true });
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/config.ts` | Create | Configuration management with defaults, env loading, validation |

## Acceptance Criteria
- [ ] `src/config.ts` exists and exports `resolveConfig`, `validateConfig`, `getDefaultConfig`, `ensureDbDirectory`
- [ ] Default config has sensible values for all fields
- [ ] `resolveConfig` merges defaults → env vars → overrides (in priority order)
- [ ] Relative `dbPath` is resolved against project directory
- [ ] `ANTHROPIC_API_KEY` env var is picked up automatically
- [ ] `validateConfig` returns errors for missing API key when compression enabled
- [ ] `validateConfig` returns errors for invalid numeric values
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Quick smoke test — import and call
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { resolveConfig, validateConfig } = require('./src/config.ts');
  const config = resolveConfig('/tmp/test-project');
  console.log('DB path:', config.dbPath);
  const errors = validateConfig(config);
  console.log('Validation errors:', errors);
"
```

## Notes
- Environment variables use `OPEN_MEM_` prefix for namespacing
- `ANTHROPIC_API_KEY` is the standard Anthropic env var (no prefix)
- The `dbPath` default `.open-mem/memory.db` keeps the database in the project directory — users should add `.open-mem/` to their `.gitignore`
- Consider logging a warning (not error) when API key is missing but compression is enabled — the plugin should still work for capture/storage, just without AI compression
