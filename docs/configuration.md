# Configuration

open-mem works out of the box with zero configuration. All settings can be customized via environment variables, a project config file, or programmatically.

## Config Precedence

Settings are resolved in this order (later sources override earlier ones):

1. **Defaults** — built-in sensible defaults
2. **`.open-mem/config.json`** — project-level config file
3. **Environment variables** — `OPEN_MEM_*` prefixed vars
4. **Programmatic overrides** — for testing or custom integrations

## Environment Variables

### Provider Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_PROVIDER` | `google` | AI provider: `google`, `anthropic`, `bedrock`, `openai`, `openrouter` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | — | API key for Google Gemini ([free](https://aistudio.google.com/apikey)) |
| `ANTHROPIC_API_KEY` | — | API key for Anthropic |
| `OPENAI_API_KEY` | — | API key for OpenAI |
| `OPENROUTER_API_KEY` | — | API key for OpenRouter |
| `OPEN_MEM_MODEL` | `gemini-2.5-flash-lite` | Model for AI compression |
| `OPEN_MEM_FALLBACK_PROVIDERS` | — | Comma-separated fallback providers (e.g., `google,anthropic,openai`) |

### Storage Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_DB_PATH` | `.open-mem/memory.db` | Path to SQLite database |
| `OPEN_MEM_RETENTION_DAYS` | `90` | Delete observations older than N days (0 = forever) |

### Processing Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_COMPRESSION` | `true` | Set to `false` to disable AI compression |
| `OPEN_MEM_BATCH_SIZE` | `5` | Observations per processing batch |
| `OPEN_MEM_IGNORED_TOOLS` | — | Comma-separated tool names to ignore (e.g., `Bash,Glob`) |

### Context Injection Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_CONTEXT_INJECTION` | `true` | Set to `false` to disable context injection |
| `OPEN_MEM_MAX_CONTEXT_TOKENS` | `4000` | Token budget for injected context |
| `OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS` | `true` | Show token costs in index entries |
| `OPEN_MEM_CONTEXT_TYPES` | all | Observation types to include |
| `OPEN_MEM_CONTEXT_FULL_COUNT` | `3` | Number of recent observations shown in full |
| `OPEN_MEM_MAX_OBSERVATIONS` | `50` | Maximum observations to consider |

### AGENTS.md Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_FOLDER_CONTEXT` | `true` | Set to `false` to disable AGENTS.md generation |
| `OPEN_MEM_FOLDER_CONTEXT_MAX_DEPTH` | `5` | Max folder depth for generation |
| `OPEN_MEM_FOLDER_CONTEXT_MODE` | `dispersed` | Mode: `dispersed` (per-folder) or `single` (one root file) |
| `OPEN_MEM_FOLDER_CONTEXT_FILENAME` | `AGENTS.md` | Filename (e.g., `CLAUDE.md` for Claude Code) |

### Platform Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_PLATFORM_OPENCODE` | `true` | Set to `false` to disable OpenCode adapter |
| `OPEN_MEM_PLATFORM_CLAUDE_CODE` | `false` | Set to `true` to enable Claude Code adapter |
| `OPEN_MEM_PLATFORM_CURSOR` | `false` | Set to `true` to enable Cursor adapter |

### MCP Settings

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_MCP_PROTOCOL_VERSION` | `2024-11-05` | Preferred MCP protocol version |
| `OPEN_MEM_MCP_SUPPORTED_PROTOCOLS` | `2024-11-05` | Comma-separated supported versions |

### Dashboard

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_DASHBOARD` | `false` | Set to `true` to enable the web dashboard |
| `OPEN_MEM_DASHBOARD_PORT` | `3737` | Dashboard HTTP port |

### Search & AI

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_ENTITY_EXTRACTION` | `false` | Enable knowledge graph entity extraction |
| `OPEN_MEM_RERANKING` | `false` | Enable LLM-based reranking of search results |
| `OPEN_MEM_RERANKING_MAX_CANDIDATES` | `20` | Max candidates to consider for reranking |
| `OPEN_MEM_EMBEDDING_DIMENSION` | auto-detected | Override embedding vector dimension (normally set from provider) |
| `OPEN_MEM_CONFLICT_RESOLUTION` | `false` | Enable conflict detection for similar observations |
| `OPEN_MEM_CONFLICT_BAND_LOW` | `0.7` | Similarity threshold below which observations are considered distinct |
| `OPEN_MEM_CONFLICT_BAND_HIGH` | `0.92` | Similarity threshold above which observations are considered duplicates |

### User Memory (Cross-Project)

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_USER_MEMORY` | `false` | Enable user-level memory shared across projects |
| `OPEN_MEM_USER_MEMORY_DB_PATH` | `~/.config/open-mem/user-memory.db` | Path to the user-level memory database |
| `OPEN_MEM_USER_MEMORY_MAX_TOKENS` | `1000` | Token budget for user-level context injection |

### Advanced

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_LOG_LEVEL` | `warn` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `OPEN_MEM_DAEMON` | `false` | Run queue processing in a background daemon |
| `OPEN_MEM_RATE_LIMITING` | `true` | Rate limiting for API calls (useful for Gemini free tier) |
| `OPEN_MEM_CONTEXT_SHOW_LAST_SUMMARY` | `true` | Include last session summary in context injection |
| `OPEN_MEM_MODE` | `code` | Workflow mode: `code` (default) or `research` |

## Config File

Create `.open-mem/config.json` in your project root for persistent configuration:

```json
{
  "provider": "google",
  "model": "gemini-2.5-flash-lite",
  "maxContextTokens": 4000,
  "compressionEnabled": true,
  "retentionDays": 90,
  "folderContextMode": "single",
  "folderContextFilename": "AGENTS.md"
}
```

The config file supports all programmatic options (see below).

## Programmatic Configuration

For testing or custom integrations, these are the full config options:

| Option | Type | Default | Description |
|---|---|---|---|
| `dbPath` | string | `.open-mem/memory.db` | SQLite database file path |
| `provider` | string | `google` | AI provider |
| `apiKey` | string | — | Provider API key |
| `model` | string | `gemini-2.5-flash-lite` | Model for compression |
| `maxTokensPerCompression` | number | `1024` | Max tokens per compression response |
| `compressionEnabled` | boolean | `true` | Enable AI compression |
| `contextInjectionEnabled` | boolean | `true` | Enable context injection |
| `maxContextTokens` | number | `4000` | Token budget for system prompt |
| `batchSize` | number | `5` | Observations per batch |
| `batchIntervalMs` | number | `30000` | Batch processing interval (ms) |
| `ignoredTools` | string[] | `[]` | Tool names to skip |
| `minOutputLength` | number | `50` | Minimum output length to capture |
| `maxIndexEntries` | number | `20` | Max index entries in context |
| `sensitivePatterns` | string[] | `[]` | Additional regex patterns to redact |
| `retentionDays` | number | `90` | Data retention period (0 = forever) |
| `maxDatabaseSizeMb` | number | `500` | Maximum database size |
| `logLevel` | string | `warn` | Log level |
| `folderContextEnabled` | boolean | `true` | Auto-generate AGENTS.md |
| `folderContextMaxDepth` | number | `5` | Max folder depth |
| `folderContextMode` | string | `dispersed` | Mode: `dispersed` or `single` |
| `folderContextFilename` | string | `AGENTS.md` | Filename for context files |
| `fallbackProviders` | string[] | — | Fallback provider chain |
| `dashboardEnabled` | boolean | `false` | Enable web dashboard |
| `dashboardPort` | number | `3737` | Dashboard HTTP port |
| `daemonEnabled` | boolean | `false` | Background daemon for queue processing |
| `rateLimitingEnabled` | boolean | `true` | Rate limiting for API calls |
| `entityExtractionEnabled` | boolean | `false` | Knowledge graph entity extraction |
| `rerankingEnabled` | boolean | `false` | LLM-based reranking of search results |
| `rerankingMaxCandidates` | number | `20` | Max candidates for reranking |
| `conflictResolutionEnabled` | boolean | `false` | Conflict detection for similar observations |
| `conflictSimilarityBandLow` | number | `0.7` | Lower similarity band for conflict detection |
| `conflictSimilarityBandHigh` | number | `0.92` | Upper similarity band for conflict detection |
| `userMemoryEnabled` | boolean | `false` | Cross-project user memory |
| `userMemoryDbPath` | string | `~/.config/open-mem/user-memory.db` | User memory database path |
| `userMemoryMaxContextTokens` | number | `1000` | Token budget for user-level context |
| `mode` | string | `code` | Workflow mode (`code` or `research`) |

## Mode Presets

open-mem includes three configuration presets that adjust processing intensity. Apply them via the dashboard or the HTTP API.

| Setting | Balanced (default) | Focus | Chill |
|---|---|---|---|
| `minOutputLength` | 50 | 120 | 200 |
| `contextFullObservationCount` | 3 | 2 | 1 |
| `maxObservations` | 50 | 30 | 15 |
| `batchSize` | 5 | 3 | 2 |
| `compressionEnabled` | true | true | **false** |

**Balanced** is the default — it captures most tool outputs and processes them in reasonable batches. **Focus** raises the minimum output threshold and reduces batch size, so only higher-signal captures get processed. **Chill** disables AI compression entirely and only retains the most substantive outputs — good for low-resource environments or when you want minimal background activity.

```bash
# List available presets
curl http://localhost:3737/v1/modes

# Apply a preset
curl -X POST http://localhost:3737/v1/modes/focus/apply
```

## Workflow Modes

Workflow modes control how observations are classified and what concepts the AI uses during compression. They're separate from mode presets — presets change runtime config, while workflow modes change the AI's vocabulary.

open-mem ships with two workflow modes:

- **`code`** (default) — observation types include `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change`. Concepts focus on `how-it-works`, `gotcha`, `pattern`, `trade-off`.
- **`research`** — tuned for research-oriented workflows with different concept vocabulary and entity types.

Set via environment variable:

```bash
export OPEN_MEM_MODE=research
```

Modes are defined as JSON files in `src/modes/`. Each mode specifies observation types, concept vocabulary, entity types for knowledge graph extraction, and relationship types.

## Dashboard Config Management

The dashboard Settings page provides a UI for:

- Viewing effective configuration with source metadata
- Previewing config changes before applying
- Applying changes to `.open-mem/config.json`
- Managing folder-context maintenance (dry-run, clean, rebuild)
