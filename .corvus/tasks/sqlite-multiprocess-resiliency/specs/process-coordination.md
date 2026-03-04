# Process Coordination Specification

## Overview
This specification defines cross-process write coordination and role-aware behavior across plugin, daemon, platform workers, and maintenance tooling.

## Status
- [ ] Draft
- [ ] Review
- [x] Approved

## Terminology
- **SHALL/MUST**: absolute requirement
- **SHOULD**: strong recommendation
- **MAY**: optional behavior

## Traceability

| Requirement | Coverage |
|-------------|----------|
| UR-1 | Write coordination and contention handling |
| UR-3 | Cross-process coordination for all process roles |
| UR-4 | Daemon/platform-worker de-duplication |
| UR-6 | Fault tolerant fallback behavior |
| UR-8 | Multi-area integration and verification |

## Specification

### Process Role Model

#### Requirements
1. The system SHALL define and propagate process roles (`plugin`, `daemon`, `platform-worker-claude`, `platform-worker-cursor`, `maintenance`).
2. Role metadata MUST be available to lock diagnostics and contention logs.
3. Coordination primitives SHALL be reusable across all roles.

### Advisory Lock Contract

#### Requirements
1. Cross-process advisory locking SHALL use a shared lock file associated with the DB path.
2. Lock acquisition MUST support bounded waiting and timeout-based failure.
3. In-process nested acquisition SHALL be reentrant and MUST NOT deadlock.
4. Lock release MUST be deterministic on success and error paths.

#### Constraints
- The lock implementation SHALL NOT rely on deleting SQLite files for recovery.

### Daemon/Worker Coordination

#### Requirements
1. Platform workers SHALL detect daemon liveness before enabling local processing.
2. When daemon is healthy, workers MUST run enqueue-only mode and signal daemon for processing.
3. When daemon is unhealthy or unavailable, workers SHALL fall back to in-process mode.
4. Duplicate processing between worker and daemon SHALL NOT occur during healthy daemon operation.

## Acceptance Scenarios

### Scenario: Coordinated writes across roles
- **Given** plugin and daemon processes share a project DB
- **When** both attempt write operations concurrently
- **Then** writes SHALL be serialized by advisory lock contract
- **And** no process SHALL perform destructive SQLite file recovery

### Scenario: Worker defers processing to healthy daemon
- **Given** daemon PID exists and process is alive
- **When** platform worker starts
- **Then** queue mode SHALL be `enqueue-only`
- **And** worker SHALL signal daemon with `PROCESS_NOW` after enqueue

### Scenario: Worker fallback on daemon failure
- **Given** platform worker is configured for daemon awareness
- **When** daemon liveness check fails
- **Then** worker SHALL switch to `in-process` mode
- **And** ingestion SHALL continue without data loss

## Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| Coordination primitive | SQLite-only busy timeout, advisory file lock + SQLite | Advisory file lock + SQLite | Explicit cross-process contract beyond busy timeout |
| Worker behavior with daemon | Always local processing, daemon-preferred | Daemon-preferred with fallback | Prevents duplicate processing while preserving availability |

## References
- `src/platform-worker.ts`
- `src/daemon/manager.ts`
- `src/runtime/queue-runtime.ts`
- `tests/integration/platform-worker.test.ts`
