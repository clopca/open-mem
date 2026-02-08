# Architecture

This document describes the internal design and data flow of open-mem.

## Design Goals

1. **Consistent behavior** across OpenCode hooks, MCP tools, and dashboard APIs
2. **Local-first storage** with predictable capture-to-recall latency
3. **Strict boundaries** so retrieval/policy changes don't require cross-cutting rewrites

## Data Flow Overview

The memory lifecycle has three phases:

1. **Capture** — OpenCode hooks (`tool.execute.after`, `chat.message`) intercept tool outputs and user prompts, redact sensitive content, and enqueue pending observations.
2. **Processing** — On `session.idle`, the queue processor batches pending items and sends them to the AI compressor. Each raw capture is distilled into a typed observation with title, narrative, concepts, and importance. Embeddings are generated in parallel when a vector-capable provider is configured.
3. **Retrieval** — At session start, the context injector assembles a token-budgeted index from recent observations and injects it into the system prompt. During the session, `memory.find` performs hybrid search and `memory.get` fetches full observation details on demand.

```
┌──────────────────────────────────────────────────────────────┐
│                        OpenCode                              │
│                                                              │
│  tool.execute.after ───> [Tool Capture Hook]                 │
│  chat.message ─────────> [Chat Capture Hook]                 │
│                                │                             │
│                                v                             │
│                       [Pending Queue]                        │
│                                │                             │
│  session.idle ─────────> [Queue Processor]                   │
│                                │                             │
│                          ┌─────┴─────┐                       │
│                          v           v                       │
│                  [AI Compressor]  [Embedding Gen]             │
│                          │           │                       │
│                          v           v                       │
│                  [SQLite + FTS5 + Vectors]                   │
│                                │                             │
│  system.transform <─── [Context Injector + ROI Footer]       │
│                                                              │
│  session.end ──────────> [AGENTS.md Generation]              │
│                                                              │
│  memory.find ─────────> [Hybrid Search (FTS5 + Vector/RRF)]  │
│  memory.create ────────> [Direct Save]                       │
│  memory.history ───────> [Session Query]                     │
│  memory.get ───────────> [Full Observation Fetch]            │
│  memory.transfer.export > [JSON Export]                      │
│  memory.transfer.import > [JSON Import]                      │
│  memory.revise ────────> [Create Revision]                   │
│  memory.remove ────────> [Tombstone Observation]             │
│  memory.help ──────────> [Workflow Guidance]                 │
│                                                              │
│  ┌──────────────────────────────────────────┐                │
│  │  MCP Server (stdin/stdout, JSON-RPC 2.0) │                │
│  │  Exposes tools to any MCP-compatible AI   │                │
│  └──────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────┘
```

## Module Structure

```
src/
├── core/                  Domain contracts + MemoryEngine orchestration
├── store/                 Store ports + SQLite adapters
├── runtime/               Queue/daemon lifecycle orchestration
├── adapters/
│   ├── opencode/          OpenCode hook + tool bindings
│   ├── mcp/               MCP server entry bindings
│   ├── platform/          Cross-platform event normalization + capabilities
│   └── http/              Dashboard API bindings
├── db/                    SQLite repositories + schema/migrations
├── queue/                 Processing pipeline implementation
└── hooks/                 Capture/context hook implementations
```

### Boundary Rules

1. `core` has no protocol or DB concrete imports
2. `store` is the only layer allowed to import SQLite store implementations
3. `adapters` translate protocol payloads to `MemoryEngine` calls
4. `runtime` coordinates queue/daemon mode, independent of adapter protocols

Boundary checks are enforced with:

```bash
bun run check:boundaries
```

## Core Contract

`MemoryEngine` is the single orchestration surface for all operations:

- Ingest/process pending work
- Search/timeline/recall
- Save/update/delete
- Export/import
- Context assembly and dashboard reads

All transports (OpenCode, MCP, HTTP) call engine methods directly — no duplicated business logic across adapters.

## Storage Model

SQLite remains local and project-scoped (`.open-mem/memory.db`), with optional user-level DB.

### Technologies

- **SQLite** — Embedded relational database, no external services
- **FTS5** — Full-text search extension for keyword queries
- **sqlite-vec** — Vector similarity search for embedding-based retrieval

### Observation Lineage

Observation lineage is immutable:

1. `memory.revise` creates a new revision row and marks the prior active row as superseded
2. `memory.remove` writes a tombstone (`deleted_at`) on the active row
3. Default retrieval/search returns only active rows (`superseded_by IS NULL` and `deleted_at IS NULL`)

Schema baseline includes v10 migration columns:

- `scope` — project or user level
- `revision_of` — links to parent observation
- `deleted_at` — tombstone timestamp

## Observation Capture

When you use tools in OpenCode (reading files, running commands, editing code), open-mem's `tool.execute.after` hook captures each execution as a pending observation. Sensitive content (API keys, tokens, passwords) is automatically redacted, and `<private>` blocks are stripped.

## AI Compression

On `session.idle`, the queue processor batches pending observations and sends them to the configured AI provider for semantic compression. Each raw tool output is distilled into a structured observation with:

- **Type classification** — decision, bugfix, feature, refactor, discovery, change
- **Title and narrative** — human-readable summary
- **Key facts** — extracted structured data
- **Concepts/tags** — for search and categorization
- **Files involved** — related file paths

If no API key is set, a fallback compressor extracts basic metadata without AI.

## Progressive Disclosure

open-mem injects a compact index into the system prompt at session start. Each entry shows a type icon, title, token cost, and related files — giving the agent a map of what's in memory without consuming the full context window.

The agent sees *what* exists and decides *what to fetch* using `memory.find` and `memory.get`. This minimizes context window usage while providing full access to all stored observations.

### Token ROI Tracking

The context injector includes a "Memory Economics" footer showing how much context compression saves: read cost vs. original discovery cost, with a savings percentage.

## Folder-Level Context (AGENTS.md)

On session end, open-mem auto-generates `AGENTS.md` files in project folders that were touched during the session. These files contain a managed section (between `<!-- open-mem-context -->` tags) with recent activity, key concepts, and decisions.

**Modes:**
- **Dispersed** (default): Creates `AGENTS.md` in each touched folder
- **Single**: Creates one root file with all folder activity grouped by section headers

User content outside the managed tags is preserved. Disable with `OPEN_MEM_FOLDER_CONTEXT=false`.

## Runtime Modes

1. **Default** — in-process queue processing
2. **Daemon** — delegates processing to a background worker

Queue runtime controls switching between modes and liveness fallback.

## External Surfaces

### OpenCode

- **Hooks**: `tool.execute.after`, `chat.message`, `event`, `experimental.chat.system.transform`, `experimental.session.compacting`
- **Tools**: All 9 `memory.*` tools

### MCP Server

- Same 9 tools over stdin/stdout JSON-RPC (`memory.*` namespace)
- Strict lifecycle support with protocol-version negotiation

### Dashboard (HTTP)

- Observations, sessions, search, and stats routes
- Config control plane (`/api/config/*`)
- Health and metrics (`/v1/health`, `/v1/metrics`)
- Folder-context maintenance endpoints

## Key Design Decisions

| Decision | Rationale |
|---|---|
| `MemoryEngine` as single surface | All transports call the same interface — no duplicated logic |
| Ports-and-Adapters pattern | Transport independence via contracts; adapters don't leak protocol concerns inward |
| SQLite + FTS5 + sqlite-vec | Zero external dependencies — full-text search and vectors in one embedded DB |
| Immutable observation lineage | Preserves audit history; simplifies conflict resolution |
| Progressive disclosure | Compact index over full dump; the agent decides what to fetch |
| Privacy-first | Redaction before storage; `<private>` stripped at capture time; all data local by default |
