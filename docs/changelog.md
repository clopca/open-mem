# Changelog

All notable changes to open-mem are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] - 2026-02-08

### Added
- **OpenRouter provider support** — access 100+ models via `OPEN_MEM_PROVIDER=openrouter` + `OPENROUTER_API_KEY`. Auto-detected from env vars, default model `google/gemini-2.5-flash-lite`. Embeddings correctly return null (OpenRouter doesn't support them).
- **Provider fallback chain** — automatic failover when primary AI provider returns retryable errors (429/500/503). Configure with `OPEN_MEM_FALLBACK_PROVIDERS=google,anthropic,openai`. Config errors (400/401/403) throw immediately without fallback. Applies only to language models, never to embeddings.
- **Timeline anchor navigation** — `mem-history` tool now accepts `anchor` (observation ID), `depthBefore`, and `depthAfter` parameters for cross-session chronological navigation around a specific observation.
- `src/ai/errors.ts` — shared `isRetryable()`, `isConfigError()`, and `sleep()` utilities extracted from 3 duplicated locations.
- `src/ai/fallback.ts` — `FallbackLanguageModel` wrapper implementing Vercel AI SDK `LanguageModel` interface with try→fail→next semantics.
- `@openrouter/ai-sdk-provider` dependency for OpenRouter integration.

### Changed
- All AI consumers (compressor, summarizer, entity-extractor, conflict-evaluator, reranker) now use `createModelWithFallback()` instead of `createModel()` — transparent fallback when configured.
- `AGENTS.md` generation now includes observation IDs, key concepts, and decision summaries in tables.
- `mem-create` tool description improved for clarity.
- Context injection now includes "When to Save" guidance with `mem-create` reference.

## [0.7.0] - 2026-02-08

### Added (Interop & Ops)
- MCP strict lifecycle support and protocol negotiation (`initialize`, `notifications/initialized`, strict pre-init gating)
- Deterministic MCP validation errors and JSON-schema tool metadata generation
- Runtime ops APIs: `GET /v1/health` and `GET /v1/metrics`
- Platform adapter foundation (`adapters/platform`) with normalized event schema and capability descriptors for OpenCode, Claude Code, and Cursor
- Dashboard Operations page showing runtime health, queue state, and throughput counters

### Added (Core 0.7.0)
- Modular architecture boundaries: `core`, `store`, `runtime`, and `adapters` layers
- `MemoryEngine` interface as single orchestration surface for all transports
- Shared API contracts with Zod schemas and `ok()`/`fail()` envelope (`contracts/api.ts`)
- Config control-plane APIs: `GET /api/config/schema`, `GET /api/config/effective`, `POST /api/config/preview`, `PATCH /api/config`
- Folder-context maintenance endpoints
- Maintenance CLI binary `open-mem-maintenance`
- Import-boundary validation script (`bun run check:boundaries`)

### Changed
- Tool names renamed from `mem-*` prefix to `memory.*` namespace (e.g., `mem-search` → `memory.find`, `mem-save` → `memory.create`)
- `memory.revise` now uses immutable revision semantics
- `memory.remove` now uses tombstone semantics (soft-delete)
- Schema baseline extended to v10 (`scope`, `revision_of`, `deleted_at` + indexes)

### Removed
- Internal backward-compatibility guarantees with pre-`0.7.0` schema internals
- Package self-dependency
- Legacy server files — replaced by adapter architecture

## [0.2.0] - 2026-02-06

### Added
- `mem-recall` tool for fetching full observation details by ID
- Progressive disclosure context injection with type icons, token costs, and file grouping
- `<private>` tag support for user-controlled content exclusion
- Structured session summaries
- Concept vocabulary guidance in AI compression prompts
- Context injection configuration options

### Fixed
- README `OPEN_MEM_CONTEXT_INJECTION` default incorrectly documented as `false`
- Missing `.open-mem/` in project .gitignore

### Changed
- License changed from AGPL-3.0 to MIT

## [0.1.0] - 2026-01-15

### Added
- Initial release
- Automatic observation capture from tool executions
- AI-powered compression using Claude (optional — works without API key)
- SQLite + FTS5 full-text search
- Context injection into new sessions via system prompt
- Three custom tools: `mem-search`, `mem-save`, `mem-timeline`
- Session summaries with AI-generated narratives
- Progressive disclosure with token budget management
- Configurable sensitive content redaction
- Data retention policies (default: 90 days)
