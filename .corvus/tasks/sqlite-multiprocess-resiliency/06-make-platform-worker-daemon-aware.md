# 06. Make Platform Worker Daemon-Aware

## Meta
- **ID**: sqlite-multiprocess-resiliency-06
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-05]
- **Effort**: L (3h)
- **Tags**: [implementation, daemon, platform-worker, integration]
- **Requires UX/DX Review**: true

## Objective
Update platform worker startup and runtime behavior to use enqueue-only mode when daemon is running, preventing duplicate processing.

## Context
Immutable requirements: **UR-3, UR-4, UR-6, UR-8**.

`src/platform-worker.ts` currently starts local queue processing unconditionally. This creates duplicate work when daemon mode is also active. Worker must become daemon-aware while retaining safe fallback behavior.

**Related Specs**:
- `specs/platform-worker-daemon-awareness.md` - Startup Mode Selection, Event Processing Semantics
- `specs/process-coordination.md` - Daemon/Worker Coordination

## Deliverables
- Daemon liveness check integrated into worker initialization
- Queue mode switch to `enqueue-only` when daemon is healthy
- Signal path to daemon for `PROCESS_NOW` after enqueue events
- Safe fallback to `in-process` when daemon is absent/unhealthy

## Implementation Steps

### Step 1: Add daemon status lookup in worker init
Leverage daemon PID/liveness utilities or manager APIs to determine daemon state per project.

### Step 2: Implement mode switching
Set queue runtime mode based on daemon health and ensure local processing is disabled in enqueue-only mode.

### Step 3: Integrate signal and fallback logic
Send `PROCESS_NOW` on enqueue in daemon mode; switch back to in-process when daemon becomes unavailable.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/platform-worker.ts` | Modify | Daemon-aware startup, mode switch, signal/fallback flow |
| `src/runtime/queue-runtime.ts` | Modify | Ensure mode transitions are explicit and safe |
| `src/daemon/manager.ts` | Modify | Reuse/get daemon status helper where needed |

## Tests

### Unit Tests
- **File**: `tests/queue/processor-mode.test.ts`
- **Test**: enqueue-only mode does not process local batches and signals callback
- **Pattern**: Arrange-Act-Assert
- **Coverage**: mode transitions and callback path

### Integration Tests
- **Scenario**: daemon alive -> worker enqueue-only behavior
- **Validation**: worker ingests and enqueues; does not local-process; daemon signal path invoked

## Acceptance Criteria

### Scenario: Worker starts enqueue-only with healthy daemon
- **Given** daemon process is alive for target project
- **When** platform worker starts
- **Then** queue mode SHALL be `enqueue-only`
- **And** local batch processing SHALL NOT run

### Scenario: Worker signals daemon after enqueue
- **Given** worker is in daemon-aware enqueue-only mode
- **When** event ingestion enqueues pending work
- **Then** worker SHALL signal daemon with `PROCESS_NOW`
- **And** response handling SHALL remain successful for ingest requests

### Scenario: Worker falls back when daemon unavailable
- **Given** worker configured for daemon-aware behavior
- **When** daemon liveness check fails
- **Then** worker SHALL switch to `in-process` mode
- **And** ingestion and processing SHALL continue without duplicate execution

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/integration/platform-worker.test.ts tests/queue/processor-mode.test.ts

# Build
bun run build
```

## Notes
- Preserve current bridge protocol response schema to avoid client breakage.
- Document behavior change: daemon becomes processing authority when healthy.
