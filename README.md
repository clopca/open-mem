# open-mem

Persistent memory plugin for [OpenCode](https://opencode.ai) — captures, compresses, and recalls context across coding sessions.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## Overview

open-mem gives your AI coding assistant long-term memory. It automatically captures what happens during your coding sessions, compresses observations using AI, stores them in a local SQLite database with full-text search, and injects relevant context from past sessions into new ones.

**Key features:**

- Automatic observation capture from tool executions
- AI-powered compression using Claude (optional — works without API key)
- SQLite + FTS5 full-text search for fast retrieval
- Context injection into new sessions via system prompt
- Three custom tools for search, save, and timeline
- Zero-config setup — works out of the box
- All data stored locally in your project directory

## Quick Start

```bash
# Install
bun add open-mem

# Add to your OpenCode config (~/.config/opencode/config.json)
{
  "plugins": {
    "open-mem": "open-mem"
  }
}
```

That's it. open-mem will start capturing observations from your next session.

For AI-powered compression (recommended), set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Installation

```bash
bun add open-mem
```

> **Note:** open-mem requires [Bun](https://bun.sh) runtime (>= 1.0.0) since it uses `bun:sqlite` for storage.

## How It Works

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
└─────────────────────────────────────────────────────┘
```

### Observation Capture

When you use tools in OpenCode (reading files, running commands, editing code), open-mem's `tool.execute.after` hook captures each execution as a pending observation. Sensitive content (API keys, tokens, passwords) is automatically redacted.

### AI Compression

On `session.idle`, the queue processor batches pending observations and sends them to Claude for semantic compression. Each raw tool output is distilled into a structured observation with:

- Type classification (decision, bugfix, feature, refactor, discovery, change)
- Title and narrative summary
- Key facts extracted
- Concepts/tags for search
- Files involved

If no Anthropic API key is set, a fallback compressor extracts basic metadata without AI.

### Context Injection

When a new session starts, the `experimental.chat.system.transform` hook retrieves relevant context from past sessions and injects it into the system prompt. This gives the AI knowledge of:

- Recent session summaries
- Relevant past observations (matched by project context)
- An index of available observations for deeper retrieval

### Session Compaction

During session compaction (`experimental.session.compacting`), open-mem injects memory context to preserve important information across compaction boundaries.

## Custom Tools

### mem-search

Search through past observations and session summaries using FTS5 full-text search.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `query` | string | yes | Search query (keywords, phrases, file paths) |
| `type` | enum | no | Filter by type: decision, bugfix, feature, refactor, discovery, change |
| `limit` | number | no | Max results (1-50, default: 10) |

### mem-save

Manually save an important observation to memory.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `title` | string | yes | Brief title (max 80 chars) |
| `type` | enum | yes | Observation type: decision, bugfix, feature, refactor, discovery, change |
| `narrative` | string | yes | Detailed description of what to remember |
| `concepts` | string[] | no | Related concepts/tags |
| `files` | string[] | no | Related file paths |

### mem-timeline

View a timeline of past coding sessions for the current project.

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `limit` | number | no | Number of recent sessions (1-20, default: 5) |
| `sessionId` | string | no | Show details for a specific session |

## Configuration

open-mem works out of the box with zero configuration. All settings can be customized via environment variables:

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | API key for AI compression (optional) |
| `OPEN_MEM_DB_PATH` | `.open-mem/memory.db` | Path to SQLite database |
| `OPEN_MEM_MODEL` | `claude-sonnet-4-20250514` | Model for AI compression |
| `OPEN_MEM_MAX_CONTEXT_TOKENS` | `4000` | Token budget for injected context |
| `OPEN_MEM_COMPRESSION` | `true` | Set to `false` to disable AI compression |
| `OPEN_MEM_CONTEXT_INJECTION` | `false` | Set to `false` to disable context injection |
| `OPEN_MEM_IGNORED_TOOLS` | — | Comma-separated tool names to ignore (e.g. `Bash,Glob`) |
| `OPEN_MEM_BATCH_SIZE` | `5` | Observations per processing batch |
| `OPEN_MEM_RETENTION_DAYS` | `90` | Delete observations older than N days |
| `OPEN_MEM_LOG_LEVEL` | `warn` | Log verbosity: debug, info, warn, error |

### Full Configuration Reference

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
| `logLevel` | string | `warn` | Log level: debug, info, warn, error |

## Privacy & Security

### Data Storage

All data is stored locally in your project's `.open-mem/` directory. No data is sent to external services except:

- **Anthropic API**: When AI compression is enabled, tool outputs are sent to Claude for compression. Disable with `OPEN_MEM_COMPRESSION=false`.

### Sensitive Content Redaction

open-mem automatically redacts common sensitive patterns from captured observations:

- API keys and tokens
- Passwords and secrets
- Environment variable values matching sensitive patterns
- Custom patterns via the `sensitivePatterns` config option

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
2. Ensure `contextInjectionEnabled` is not set to `false`
3. Check that observations exist: use the `mem-timeline` tool
4. The first session won't have context — observations must be captured first

### High memory usage

If the database grows too large, adjust retention:

```bash
export OPEN_MEM_RETENTION_DAYS=30
export OPEN_MEM_MAX_CONTEXT_TOKENS=2000
```

## Contributing

1. Clone the repository
2. Install dependencies: `bun install`
3. Run tests: `bun test`
4. Type check: `bun run typecheck`
5. Lint: `bun run lint`
6. Build: `bun run build`

### Project Structure

```
src/
├── index.ts              Plugin entry point
├── types.ts              TypeScript interfaces
├── config.ts             Configuration management
├── db/                   SQLite + FTS5 data layer
├── ai/                   AI compression & summarization
├── hooks/                OpenCode hook handlers
├── queue/                Batch queue processor
├── context/              Context retrieval & injection
└── tools/                Custom tool definitions
```

## License

[AGPL-3.0](LICENSE)
