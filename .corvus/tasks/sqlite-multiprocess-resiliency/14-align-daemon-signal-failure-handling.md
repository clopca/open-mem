# 14. Align Daemon Signal Failure Handling

## Meta
- **ID**: sqlite-multiprocess-resiliency-14
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-13]
- **Effort**: M (2h)
- **Tags**: [implementation, daemon, signaling, reliability]
- **Requires UX/DX Review**: false

## Objective
Make daemon signal failure behavior consistent between platform-worker and plugin queue paths by applying explicit fallback handling when `PROCESS_NOW` signaling fails.

## Context
Immutable requirements: **UR-3, UR-4, UR-6, UR-8**.

`src/platform-worker.ts` already falls back to in-process mode when `daemonManager.signal("PROCESS_NOW")` fails, but `src/index.ts` currently enqueues with `queueRuntime.setEnqueueOnly(() => daemonManager?.signal("PROCESS_NOW"))` and ignores failed signal results. This creates inconsistent operational behavior across entrypoints.

**Related Specs**:
- `specs/process-coordination.md`
- `specs/platform-worker-daemon-awareness.md`

## Deliverables
- Unified signal-failure fallback contract in plugin and platform-worker paths
- Deterministic handling for `no-daemon`, `daemon-dead`, and `delivery-failed` outcomes
- Test coverage proving parity of fallback behavior expectations

## Implementation Steps

### Step 1: Define shared fallback contract
Codify expected behavior: if signaling `PROCESS_NOW` returns `ok: false`, runtime MUST leave enqueue-only mode and switch to in-process processing.

### Step 2: Apply plugin-path parity
Update `src/index.ts` enqueue-only callback to inspect `DaemonSignalResult` and perform the same fallback used by platform-worker.

### Step 3: Add regression tests for parity
Add tests covering failed signal paths and asserting mode fallback occurs consistently.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/index.ts` | Modify | Handle `PROCESS_NOW` signal failure with explicit fallback to in-process mode |
| `src/platform-worker.ts` | Modify | Ensure fallback logic remains aligned with plugin behavior |
| `tests/integration/platform-worker.test.ts` | Modify | Add/extend signal failure fallback assertions |
| `tests/daemon/manager.test.ts` | Modify | Verify failure states used by fallback contract |

## Tests

### Unit Tests
- **File**: `tests/daemon/manager.test.ts`
- **Test**: failure states are explicit and usable by callers for fallback decisions
- **Pattern**: Arrange-Act-Assert
- **Coverage**: `DaemonSignalResult` semantics

### Integration Tests
- **Scenario**: enqueue-only path receives signal failure
- **Validation**: runtime mode flips to `in-process` in both plugin and platform-worker flows

## Acceptance Criteria

### Scenario: Plugin fallback on signal failure
- **Given** daemon mode is enabled and queue runtime is enqueue-only in plugin path
- **When** `daemonManager.signal("PROCESS_NOW")` returns `ok: false`
- **Then** plugin runtime SHALL switch to `in-process` mode
- **And** subsequent queue processing SHALL proceed without daemon signal dependency

### Scenario: Platform-worker parity
- **Given** platform-worker is in enqueue-only mode
- **When** daemon signaling fails with any non-ok result
- **Then** worker runtime SHALL switch to `in-process` mode
- **And** behavior SHALL match plugin fallback expectations

### Scenario: Validation baseline
- **Given** signal parity changes are complete
- **When** validation commands run
- **Then** targeted tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run targeted daemon/platform coordination tests
bun test tests/daemon/manager.test.ts tests/integration/platform-worker.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep fallback behavior deterministic and avoid oscillating between modes.
- Preserve existing daemon liveness polling behavior.
