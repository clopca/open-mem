# Platform Worker Daemon Awareness Specification

## Overview
This specification defines platform-worker runtime behavior when daemon mode is available, including enqueue-only execution and fallback semantics.

## Status
- [ ] Draft
- [ ] Review
- [x] Approved

## Terminology
- **SHALL/MUST**: absolute requirement
- **SHOULD**: recommended behavior
- **MAY**: optional behavior

## Traceability

| Requirement | Coverage |
|-------------|----------|
| UR-3 | Shared coordination with daemon and DB write path |
| UR-4 | Daemon-aware worker mode |
| UR-6 | Fault-tolerant fallback and graceful shutdown |
| UR-8 | Integration across adapters and process surfaces |

## Specification

### Startup Mode Selection

#### Requirements
1. Worker startup SHALL check daemon liveness for the target project before choosing queue mode.
2. If daemon is running, worker MUST set queue mode to `enqueue-only`.
3. If daemon is not running, worker SHALL set queue mode to `in-process` and start local processing.

### Event Processing Semantics

#### Requirements
1. In `enqueue-only` mode, worker SHALL ingest events and enqueue records only.
2. In `enqueue-only` mode, worker MUST notify daemon (`PROCESS_NOW`) after enqueue operations.
3. In `in-process` mode, worker SHALL preserve current processing behavior.

### Health and Observability

#### Requirements
1. Worker health response SHALL include current queue mode and daemon-coordination status.
2. Mode changes (daemon available/unavailable) SHOULD produce explicit log events.
3. Worker shutdown MUST flush pending work according to mode semantics.

## Acceptance Scenarios

### Scenario: Healthy daemon at worker startup
- **Given** a running daemon for the same project
- **When** `open-mem-claude-code` or `open-mem-cursor` starts
- **Then** worker SHALL report `enqueue-only` queue mode
- **And** local queue timer SHALL NOT process batches directly

### Scenario: Daemon not available at startup
- **Given** no live daemon process for the project
- **When** platform worker starts
- **Then** worker SHALL use `in-process` queue mode
- **And** local batch processing SHALL function normally

### Scenario: Daemon-aware flush command
- **Given** worker is in `enqueue-only` mode
- **When** a flush command is issued
- **Then** worker SHALL attempt daemon signal and provide structured response
- **And** it SHALL NOT duplicate batch processing locally

## Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| Worker processing responsibility | Always local, daemon-only, daemon-aware hybrid | Daemon-aware hybrid | Reduces duplication while preserving fallback safety |
| Flush behavior in enqueue-only mode | Local processBatch, daemon signal, both | Daemon signal-first without local duplicate batch | Prevents duplicate batch handling |

## References
- `src/platform-worker.ts`
- `src/daemon/manager.ts`
- `tests/integration/platform-worker.test.ts`
- `tests/daemon/ipc.test.ts`
