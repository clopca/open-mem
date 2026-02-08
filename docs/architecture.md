# Architecture

This document describes the current modular architecture of open-mem.

## Design Goals

1. Keep memory behavior consistent across OpenCode hooks, MCP tools, and dashboard APIs.
2. Keep local-first storage and predictable capture-to-recall latency.
3. Keep boundaries strict so retrieval/policy changes do not require cross-cutting rewrites.

## Layered Modules

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

## Boundary Rules

1. `core` has no protocol or DB concrete imports.
2. `store` is the only layer allowed to import SQLite store implementations.
3. `adapters` translate protocol payloads to `MemoryEngine` calls.
4. `runtime` coordinates queue/daemon mode, independent of adapter protocols.

Boundary checks are enforced with:

```bash
bun run check:boundaries
```

## Core Contract

`MemoryEngine` is the single orchestration surface for:

- ingest/process pending work
- search/timeline/recall
- save/update/delete
- export/import
- context assembly and dashboard reads

OpenCode, MCP, and HTTP surfaces call engine methods directly.

## Storage Model

SQLite remains local and project-scoped (`.open-mem/memory.db`), with optional user-level DB.

Observation lineage is immutable:

1. `memory.revise` creates a new revision row and marks prior active row superseded.
2. `memory.remove` writes a tombstone (`deleted_at`) on active row.
3. Default retrieval/search returns only active rows (`superseded_by IS NULL` and `deleted_at IS NULL`).

Schema baseline includes v10 migration columns:

- `scope`
- `revision_of`
- `deleted_at`

## Runtime Modes

1. Default: in-process queue processing.
2. Optional: daemon mode delegates processing to background worker.

Queue runtime controls switching between modes and liveness fallback.

## Data Flow

The memory lifecycle has three phases:

1. **Capture** — OpenCode hooks (`tool.execute.after`, `chat.message`) intercept tool outputs and user prompts, redact sensitive content, and enqueue pending observations.
2. **Processing** — On `session.idle`, the queue processor batches pending items and sends them to the AI compressor. Each raw capture is distilled into a typed observation with title, narrative, concepts, and importance. Embeddings are generated in parallel when a vector-capable provider is configured.
3. **Retrieval** — At session start, the context injector assembles a token-budgeted index from recent observations and injects it into the system prompt. During the session, `memory.find` performs hybrid search (FTS5 + vector/RRF) and `memory.get` fetches full observation details on demand.

```
Hooks ──> Pending Queue ──> AI Compressor + Embeddings ──> SQLite/FTS5/Vectors
                                                                  │
Context Injector <── search/recall <── memory.find / memory.get <─┘
```

## Key Design Decisions

- **`MemoryEngine` as single orchestration surface** — All transports (OpenCode, MCP, HTTP) call the same engine interface, eliminating duplicated business logic across adapters.
- **Ports-and-Adapters for transport independence** — `core/contracts.ts` defines the engine port; `store/ports.ts` defines storage ports. Adapters in `adapters/` translate protocol payloads without leaking transport concerns inward.
- **SQLite + FTS5 + sqlite-vec for zero external dependencies** — Local-first storage with full-text search and vector similarity in a single embedded database. No Redis, no Postgres, no network services.
- **Immutable observation lineage** — `memory.revise` creates successor revisions rather than mutating in place; `memory.remove` writes tombstones. This preserves audit history and simplifies conflict resolution.
- **Progressive disclosure** — The context injector shows a compact index (type, title, token cost) rather than full observations. The agent decides what to fetch, minimizing context window consumption.
- **Privacy-first** — Sensitive content is redacted before storage, `<private>` blocks are stripped at capture time, and all data stays local unless AI compression is explicitly enabled.

## External Surfaces

### OpenCode

- Hooks: `tool.execute.after`, `chat.message`, `event`, `experimental.chat.system.transform`, `experimental.session.compacting`
- Tools: `memory.find`, `memory.create`, `memory.history`, `memory.get`, `memory.revise`, `memory.remove`, `memory.transfer.export`, `memory.transfer.import`, `memory.help`

### MCP

- Same 9 tools over stdin/stdout JSON-RPC (`memory.*` namespace).
- Strict lifecycle support (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`) with protocol-version negotiation.

### Dashboard

- Existing observations/sessions/search/stats routes
- Runtime operations routes:
  - `GET /v1/health`
  - `GET /v1/metrics`
- Config control plane:
  - `GET /api/config/schema`
  - `GET /api/config/effective`
  - `POST /api/config/preview`
  - `PATCH /api/config`
- Folder-context maintenance:
  - `POST /api/maintenance/folder-context/dry-run`
  - `POST /api/maintenance/folder-context/clean`
  - `POST /api/maintenance/folder-context/rebuild`

## Compatibility Policy

`0.7.0` does not preserve internal compatibility with earlier schema internals. For pre-`0.7.0` local data, use maintenance reset flow.
