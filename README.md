# open-mem

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.2.0-green.svg)](https://github.com/clopca/open-mem)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-pink.svg)](https://bun.sh)

Persistent memory for [OpenCode](https://opencode.ai) — captures, compresses, and recalls context across coding sessions.

## Requirements

- [OpenCode](https://opencode.ai) (the AI coding assistant)
- [Bun](https://bun.sh) >= 1.0

## Quick Start

### Install

```bash
bun add github:clopca/open-mem
```

### Configure OpenCode

Add `open-mem` to the `plugin` array in your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["open-mem"]
}
```

> **Note**: If you already have plugins, just append `"open-mem"` to the existing array.

That's it. open-mem starts capturing from your next OpenCode session.

### Enable AI Compression (Optional)

For intelligent compression of observations using Claude:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without an API key, open-mem still works — it falls back to a basic metadata extractor that captures tool names, file paths, and output snippets.

## Key Features

- 🧠 **Automatic observation capture** from tool executions
- 🤖 **AI-powered compression** using Claude (optional — works without API key)
- 🔍 **SQLite + FTS5** full-text search for fast retrieval
- 💡 **Progressive disclosure** with token-cost-aware context injection
- 🔒 **Privacy controls** with `<private>` tag support
- 🛠️ **Four custom tools**: mem-search, mem-save, mem-timeline, mem-recall
- ⚡ **Zero-config setup** — works out of the box
- 📁 **All data stored locally** in your project directory

## How It Works

open-mem runs in the background as an OpenCode plugin. When you use tools (reading files, running commands, editing code), it captures what happened. During idle time, it compresses those captures into structured observations using AI. At the start of your next session, it injects a compact memory index into the system prompt — so your agent knows what you've been working on.

```
┌─────────────────────────────────────────────────────┐
│                     OpenCode                        │
│                                                     │
│  tool.execute.after ───> [Tool Capture Hook]        │
│                                │                    │
│                                v                    │
│                       [Pending Queue]               │
│                                │                    │
│  session.idle ─────────> [Queue Processor]          │
│                                │                    │
│                                v                    │
│                      [AI Compressor] ───> Anthropic │
│                                │                    │
│                                v                    │
│                      [SQLite + FTS5]                │
│                                │                    │
│  system.transform <─── [Context Injector]           │
│                                                     │
│  mem-search ─────────> [FTS5 Search]                │
│  mem-save ───────────> [Direct Save]                │
│  mem-timeline ───────> [Session Query]              │
│  mem-recall ─────────> [Full Observation Fetch]     │
└─────────────────────────────────────────────────────┘
```

### Observation Capture

When you use tools in OpenCode (reading files, running commands, editing code), open-mem's `tool.execute.after` hook captures each execution as a pending observation. Sensitive content (API keys, tokens, passwords) is automatically redacted, and `<private>` blocks are stripped.

### AI Compression

On `session.idle`, the queue processor batches pending observations and sends them to Claude for semantic compression. Each raw tool output is distilled into a structured observation with:

- Type classification (decision, bugfix, feature, refactor, discovery, change)
- Title and narrative summary
- Key facts extracted
- Concepts/tags for search
- Files involved

If no Anthropic API key is set, a fallback compressor extracts basic metadata without AI.

### Progressive Disclosure

open-mem injects a compact index into the system prompt at session start. Each entry shows a type icon, title, token cost, and related files — giving the agent a map of what's in memory without consuming the full context window.

The agent sees *what* exists and decides *what to fetch* using `mem-search` and `mem-recall`. This minimizes context window usage while providing full access to all stored observations.

Example of an injected index entry:

```
🔧 [refactor] Extract pricing logic (~120 tokens) — src/pricing.ts
💡 [discovery] FTS5 requires specific tokenizer config (~85 tokens)
```

### Session Compaction

During session compaction (`experimental.session.compacting`), open-mem injects memory context to preserve important information across compaction boundaries.

## Custom Tools

### mem-search

Search through past observations and session summaries using FTS5 full-text search.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | yes | Search query (keywords, phrases, file paths) |
| `type` | enum | no | Filter by type: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change` |
| `limit` | number | no | Max results (1–50, default: 10) |

### mem-save

Manually save an important observation to memory.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | yes | Brief title (max 80 chars) |
| `type` | enum | yes | Observation type: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change` |
| `narrative` | string | yes | Detailed description of what to remember |
| `concepts` | string[] | no | Related concepts/tags |
| `files` | string[] | no | Related file paths |

### mem-timeline

View a timeline of past coding sessions for the current project.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `limit` | number | no | Number of recent sessions (1–20, default: 5) |
| `sessionId` | string | no | Show details for a specific session |

### mem-recall

Fetch full observation details by ID. Use after `mem-search` to get complete narratives, facts, concepts, and file lists for specific observations.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `ids` | string[] | yes | Observation IDs to fetch |
| `limit` | number | no | Maximum number of results (1–50, default: 10) |

## Configuration

open-mem works out of the box with zero configuration. All settings can be customized via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | API key for AI compression (optional) |
| `OPEN_MEM_DB_PATH` | `.open-mem/memory.db` | Path to SQLite database |
| `OPEN_MEM_MODEL` | `claude-sonnet-4-20250514` | Model for AI compression |
| `OPEN_MEM_MAX_CONTEXT_TOKENS` | `4000` | Token budget for injected context |
| `OPEN_MEM_COMPRESSION` | `true` | Set to `false` to disable AI compression |
| `OPEN_MEM_CONTEXT_INJECTION` | `true` | Set to `false` to disable context injection |
| `OPEN_MEM_IGNORED_TOOLS` | — | Comma-separated tool names to ignore (e.g. `Bash,Glob`) |
| `OPEN_MEM_BATCH_SIZE` | `5` | Observations per processing batch |
| `OPEN_MEM_RETENTION_DAYS` | `90` | Delete observations older than N days (0 = forever) |
| `OPEN_MEM_LOG_LEVEL` | `warn` | Log verbosity: `debug`, `info`, `warn`, `error` |
| `OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS` | `true` | Show token costs in context index entries |
| `OPEN_MEM_CONTEXT_TYPES` | all | Observation types to include in context injection |
| `OPEN_MEM_CONTEXT_FULL_COUNT` | `3` | Number of recent observations shown in full |
| `OPEN_MEM_MAX_OBSERVATIONS` | `50` | Maximum observations to consider for context |

<details>
<summary><strong>Programmatic Configuration Reference</strong></summary>

If you need to configure open-mem programmatically (e.g. for testing or custom integrations), these are the full config options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | string | `.open-mem/memory.db` | SQLite database file path |
| `apiKey` | string | `undefined` | Anthropic API key |
| `model` | string | `claude-sonnet-4-20250514` | Claude model for compression |
| `maxTokensPerCompression` | number | `1024` | Max tokens per compression response |
| `compressionEnabled` | boolean | `true` | Enable AI compression |
| `contextInjectionEnabled` | boolean | `true` | Enable context injection |
| `maxContextTokens` | number | `4000` | Token budget for system prompt injection |
| `batchSize` | number | `5` | Observations per batch |
| `batchIntervalMs` | number | `30000` | Batch processing interval (ms) |
| `ignoredTools` | string[] | `[]` | Tool names to skip |
| `minOutputLength` | number | `50` | Minimum output length to capture |
| `maxIndexEntries` | number | `20` | Max observation index entries in context |
| `sensitivePatterns` | string[] | `[]` | Additional regex patterns to redact |
| `retentionDays` | number | `90` | Data retention period (0 = forever) |
| `maxDatabaseSizeMb` | number | `500` | Maximum database size |
| `logLevel` | string | `warn` | Log level: `debug`, `info`, `warn`, `error` |

</details>

## Privacy & Security

### Local Data Storage

All data is stored locally in your project's `.open-mem/` directory. No data leaves your machine except when AI compression is enabled.

### Anthropic API

When AI compression is enabled, tool outputs are sent to Claude for compression. Disable with `OPEN_MEM_COMPRESSION=false` to keep everything fully local.

### Automatic Redaction

open-mem automatically redacts common sensitive patterns before storage:

- API keys and tokens (e.g. `sk-ant-...`, `ghp_...`, `Bearer ...`)
- Passwords and secrets
- Environment variable values matching sensitive patterns
- Custom patterns via the `sensitivePatterns` config option

### `<private>` Tags

Wrap any content in `<private>...</private>` tags to exclude it from memory entirely. Private blocks are stripped before observation capture — they never reach the database or the Anthropic API.

```
<private>
This content will not be stored in memory.
</private>
```

### Gitignore

Add `.open-mem/` to your `.gitignore` to prevent committing memory data:

```bash
echo '.open-mem/' >> .gitignore
```

## Troubleshooting

### "AI compression enabled but no ANTHROPIC_API_KEY found"

This is a warning, not an error. open-mem works without an API key — it falls back to a basic metadata extractor. To enable AI compression:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Database errors

If you encounter SQLite errors, try removing the database and letting it recreate:

```bash
rm -rf .open-mem/
```

### Context not appearing in sessions

1. Verify the plugin is loaded: check OpenCode logs for `[open-mem]` messages
2. Ensure `OPEN_MEM_CONTEXT_INJECTION` is not set to `false`
3. Check that observations exist: use the `mem-timeline` tool
4. The first session won't have context — observations must be captured first

### High memory usage

If the database grows too large, adjust retention:

```bash
export OPEN_MEM_RETENTION_DAYS=30
export OPEN_MEM_MAX_CONTEXT_TOKENS=2000
```

## Uninstalling

1. Remove `"open-mem"` from the `plugin` array in your OpenCode config (`~/.config/opencode/opencode.json`).

2. Remove the package:
   ```bash
   bun remove open-mem
   ```

3. Optionally, delete stored memory data:
   ```bash
   rm -rf .open-mem/
   ```

## Documentation

- [Getting Started](docs/getting-started.md) — installation, configuration, and first steps
- [Architecture](docs/architecture.md) — internal design, data flow, and source layout

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and submission guidelines.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of changes.

## License

[MIT](LICENSE)
