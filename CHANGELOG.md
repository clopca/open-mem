# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-02-08

### Added (Interop & Ops)
- MCP strict lifecycle support and protocol negotiation (`initialize`, `notifications/initialized`, strict pre-init gating)
- Deterministic MCP validation errors and JSON-schema tool metadata generation
- Runtime ops APIs: `GET /v1/health` and `GET /v1/metrics`
- Platform adapter foundation (`adapters/platform`) with normalized event schema and capability descriptors for OpenCode, Claude Code, and Cursor
- Dashboard Operations page showing runtime health, queue state, and throughput counters
- Benchmark scripts:
  - `bun run bench:search`
  - `bun run bench:platform`
- MCP compatibility matrix documentation (`docs/mcp-compatibility-matrix.md`)
- External compatibility GA scaffolding:
  - verification harness (`scripts/verify-external-clients.ts`)
  - worker bridge smoke checks (`scripts/smoke-platform-workers.ts`)
  - matrix renderer + release gate scripts (`scripts/render-compat-matrix.ts`, `scripts/check-external-compat-gate.ts`)
  - CI workflows for nightly compatibility evidence and release blocking (`.github/workflows/external-compat.yml`, `.github/workflows/release-gate.yml`)

### Added (Core 0.7.0)
- Modular architecture boundaries: `core`, `store`, `runtime`, and `adapters` layers
- `MemoryEngine` interface as single orchestration surface for all transports
- Shared API contracts with Zod schemas and `ok()`/`fail()` envelope (`contracts/api.ts`)
- Config control-plane APIs: `GET /api/config/schema`, `GET /api/config/effective`, `POST /api/config/preview`, `PATCH /api/config`
- Folder-context maintenance endpoints:
  - `POST /api/maintenance/folder-context/dry-run`
  - `POST /api/maintenance/folder-context/clean`
  - `POST /api/maintenance/folder-context/rebuild`
- Maintenance CLI binary `open-mem-maintenance`:
  - `reset-db --project <path>`
  - `folder-context clean|rebuild [--dry-run]`
- Import-boundary validation script (`bun run check:boundaries`)

### Changed
- Tool names renamed from `mem-*` prefix to `memory.*` namespace (e.g. `mem-search` → `memory.find`, `mem-save` → `memory.create`)
- `memory.revise` now uses immutable revision semantics (creates a successor revision)
- `memory.remove` now uses tombstone semantics (soft-delete active observation)
- Active retrieval/search now returns only non-superseded, non-tombstoned observations
- Schema baseline extended to v10 (`scope`, `revision_of`, `deleted_at` + indexes)
- Dashboard Settings now includes editable config with preview/apply and folder-context maintenance controls

### Removed
- Internal backward-compatibility guarantees with pre-`0.7.0` schema internals
- Package self-dependency (`open-mem` depending on itself)
- Legacy `servers/http-server.ts`, `servers/mcp-server.ts`, `servers/sse-broadcaster.ts` — replaced by `adapters/http/`, `adapters/mcp/`, `adapters/http/sse.ts`

### Notes
- Local-first storage remains in project `.open-mem/` (plus optional user-level DB)
- Pre-`0.7.0` local databases are not auto-migrated to immutable lineage semantics; use the maintenance reset flow

## [0.2.0] - 2026-02-06

### Added
- `mem-recall` tool for fetching full observation details by ID
- Progressive disclosure context injection with type icons, token costs, and file grouping
- `<private>` tag support for user-controlled content exclusion from memory
- Structured session summaries with request, investigated, learned, completed, and next steps fields
- Concept vocabulary guidance in AI compression prompts (how-it-works, gotcha, pattern, trade-off, etc.)
- Context injection configuration options (token cost display, observation type filters, full observation count)

### Fixed
- README `OPEN_MEM_CONTEXT_INJECTION` default incorrectly documented as `false` (actual default: `true`)
- Missing `.open-mem/` in project .gitignore

### Changed
- License changed from AGPL-3.0 to MIT

## [0.1.0] - 2026-01-15

### Added
- Initial release
- Automatic observation capture from tool executions
- AI-powered compression using Claude (optional — works without API key)
- SQLite + FTS5 full-text search for fast retrieval
- Context injection into new sessions via system prompt
- Three custom tools: `mem-search`, `mem-save`, `mem-timeline`
- Session summaries with AI-generated narratives
- Progressive disclosure with token budget management
- Configurable sensitive content redaction
- Data retention policies (default: 90 days)
- 162 tests with 395 assertions
