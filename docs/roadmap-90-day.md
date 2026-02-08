# 90-Day Competitive Roadmap (Execution Baseline)

## Scope

This roadmap targets the highest-impact competitive gaps while preserving open-mem's architectural simplicity.

## Phase 1 (Days 1-30) — Interop Foundation

### Delivered in this baseline

- MCP lifecycle hardening in strict mode:
  - protocol negotiation and version checks
  - `notifications/initialized` handling
  - deterministic validation error mapping
  - stable tool metadata and JSON schema output
- Runtime health + metrics API endpoints:
  - `GET /v1/health`
  - `GET /v1/metrics`
- Platform adapter foundation:
  - normalized platform event schema
  - builtin adapter descriptors and capability flags for OpenCode / Claude Code / Cursor
- Regression tests for MCP behavior and metrics endpoints
- Compatibility matrix documentation

### Remaining for Phase 1 completion

- external client integration verification runs (Claude Code, Cursor)
- benchmark scripts and published baseline numbers (`docs/benchmark-baseline.md`)

## Phase 2 (Days 31-60) — Platform Expansion

- Implement ingest adapters for Claude Code and Cursor using normalized event model
- Add parity replay tests for equivalent session behavior across all adapters
- Publish installation/config docs for each platform

## Phase 3 (Days 61-90) — Dashboard and Hardening

- Add operations dashboard views that consume `/v1/health` and `/v1/metrics`
- Add lineage and search explainability UI
- Performance tuning and release hardening

## Success Gates

- MCP strict compatibility tests remain green
- No duplicated business logic across adapters
- No mandatory external runtime dependencies introduced
