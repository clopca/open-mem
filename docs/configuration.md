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
| `OPEN_MEM_MCP_COMPAT_MODE` | `strict` | MCP mode: `strict` or `legacy` |
| `OPEN_MEM_MCP_PROTOCOL_VERSION` | `2024-11-05` | Preferred MCP protocol version |
| `OPEN_MEM_MCP_SUPPORTED_PROTOCOLS` | `2024-11-05` | Comma-separated supported versions |

### General

| Variable | Default | Description |
|---|---|---|
| `OPEN_MEM_LOG_LEVEL` | `warn` | Log verbosity: `debug`, `info`, `warn`, `error` |

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

## Mode Presets

open-mem includes built-in configuration presets for common scenarios:

- **Balanced** (default) — standard settings for general use
- **Focus** — reduced noise, higher quality observations
- **Chill** — minimal processing, lower resource usage

Apply a mode via the dashboard or the HTTP API:

```bash
# List available modes
curl http://localhost:PORT/api/modes

# Apply a mode
curl -X POST http://localhost:PORT/api/modes/focus/apply
```

## Dashboard Config Management

The dashboard Settings page provides a UI for:

- Viewing effective configuration with source metadata
- Previewing config changes before applying
- Applying changes to `.open-mem/config.json`
- Managing folder-context maintenance (dry-run, clean, rebuild)
