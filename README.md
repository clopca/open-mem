<div align="center">
  <h1>open-mem</h1>
  <p>Persistent memory for AI coding assistants.<br/>Captures what you do, compresses it, recalls it next session.</p>

  <a href="docs/getting-started.md">Documentation</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/clopca/open-mem/issues">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="CHANGELOG.md">Changelog</a>
</div>

<br/>

<p align="center">
  <a href="https://www.npmjs.com/package/open-mem"><img src="https://img.shields.io/npm/v/open-mem.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-%3E%3D1.0-pink.svg" alt="Bun"></a>
</p>

---

## What is open-mem?

open-mem is a plugin for [OpenCode](https://opencode.ai) that gives your AI assistant memory across sessions. It runs in the background — when you read files, run commands, or edit code, it captures what happened. During idle time, it compresses those captures into structured observations using AI. Next session, it injects a compact summary into the system prompt so the agent picks up where you left off.

It also works with **Claude Code**, **Cursor**, and any **MCP-compatible client**.

### How it works

You use tools, open-mem captures the outputs, AI compresses them into structured observations, and SQLite stores everything locally. Next session, a compact index gets injected into the system prompt so the agent picks up where you left off.

## Quick start

```bash
bun add open-mem
```

Add it to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["open-mem"]
}
```

That's it. open-mem starts capturing from your next session.

### AI compression (optional)

By default, open-mem uses a basic metadata extractor. For semantic compression, add an AI provider:

```bash
# Google Gemini — free tier available
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

Also supports Anthropic, AWS Bedrock, OpenAI, and OpenRouter. Auto-detects from environment variables. See [Configuration](docs/configuration.md) for all providers.

## Features

**Search & retrieval** — hybrid search combining FTS5 full-text, vector embeddings (via sqlite-vec), knowledge graph traversal, and Reciprocal Rank Fusion. No external vector database needed.

**AI compression** — raw tool outputs distilled into typed observations (decision, bugfix, feature, refactor, discovery, change) with titles, narratives, concepts, and importance scores. 5 providers with automatic fallback chain.

**Progressive disclosure** — a token-budgeted index is injected into the system prompt. The agent sees *what* exists and decides *what to fetch*. Typical compression ratio: ~96%.

**Knowledge graph** — automatic entity extraction with relationships. Graph-augmented search finds connections across sessions that keyword search would miss.

**Revision lineage** — observations are immutable. Updates create new revisions that supersede the previous one. Deletes are tombstones. Full audit trail.

**9 memory tools** — `memory.find`, `memory.create`, `memory.history`, `memory.get`, `memory.revise`, `memory.remove`, `memory.transfer.export`, `memory.transfer.import`, `memory.help`. See [Tools reference](docs/tools.md).

**AGENTS.md generation** — auto-generates folder-level context files on session end so the agent has project awareness even without the plugin loaded.

**Web dashboard** — timeline, sessions, search, stats, operations, and settings. Real-time updates via SSE. Config control plane with live preview and rollback.

**Privacy-first** — all data stored locally in `.open-mem/`. Automatic redaction of API keys, tokens, passwords. `<private>` tags to exclude content entirely. See [Privacy & Security](docs/privacy.md).

## Multi-platform

open-mem isn't limited to OpenCode. Dedicated adapters bring the same capabilities to other tools:

| Platform | Integration |
|----------|------------|
| **OpenCode** | Native plugin (hooks + tools) |
| **Claude Code** | `bunx open-mem-claude-code --project /path/to/project` |
| **Cursor** | `bunx open-mem-cursor --project /path/to/project` |
| **Any MCP client** | `bunx open-mem-mcp --project /path/to/project` |

See [Platform Adapters](docs/platforms.md) for setup details.

## Dashboard

```bash
export OPEN_MEM_DASHBOARD=true
# Access at http://localhost:3737
```

Six pages: Timeline, Sessions, Search, Stats, Operations, Settings. The Settings page doubles as a config control plane — preview changes, apply them, roll back if needed.

## Documentation

- [Getting Started](docs/getting-started.md) — installation and first steps
- [Architecture](docs/architecture.md) — internal design and data flow
- [Memory Tools](docs/tools.md) — all 9 tools with arguments and examples
- [Search](docs/search.md) — how hybrid search works
- [Configuration](docs/configuration.md) — environment variables and config file
- [Privacy & Security](docs/privacy.md) — data handling and redaction
- [Platform Adapters](docs/platforms.md) — Claude Code, Cursor, MCP server
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

## Comparison

| | open-mem | Typical alternatives |
|---|---|---|
| Vector search | Embedded (sqlite-vec) | External service |
| AI providers | 5 + fallback chain | 1–3 |
| Search | FTS5 + Vector + RRF + Graph | FTS5 only |
| Knowledge graph | Yes | No |
| Revision history | Immutable lineage | No |
| Dashboard | Web UI with SSE | No |
| Data storage | Project-local | Global |
| License | MIT | AGPL / proprietary |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
