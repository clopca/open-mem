# 13. Add Platform-Worker PID Lifecycle

## Meta
- **ID**: sqlite-multiprocess-resiliency-13
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-12]
- **Effort**: M (3h)
- **Tags**: [implementation, process-coordination, pid, reliability]
- **Requires UX/DX Review**: false

## Objective
Implement PID file create/remove lifecycle for Claude and Cursor platform workers so maintenance preflight reflects real worker liveness.

## Context
Immutable requirements: **UR-3, UR-4, UR-5, UR-6, UR-8**.

`getMaintenancePreflightStatus()` already checks `platform-worker-claude.pid` and `platform-worker-cursor.pid`, but `src/platform-worker.ts` does not currently write/remove those files. This creates a UX/DX mismatch where preflight implies worker detection coverage that runtime does not provide.

**Related Specs**:
- `specs/process-coordination.md`
- `specs/platform-worker-daemon-awareness.md`
- `specs/maintenance-safety.md`

## Deliverables
- Worker PID path resolution for platform-specific worker types
- PID file write on worker startup and removal on all shutdown paths
- Integration coverage proving PID lifecycle for both worker entrypoints

## Implementation Steps

### Step 1: Add platform-worker PID path helper
Extend PID utilities so worker code can resolve the correct PID file for `claude-code` and `cursor` worker roles.

### Step 2: Write and clean PID files in worker lifecycle
In `src/platform-worker.ts`, write PID after initialization succeeds, and remove PID file in shutdown/finalization handlers (`shutdown`, `SIGINT`, `SIGTERM`, and readline close flow).

### Step 3: Add integration tests for PID lifecycle
Add tests that verify PID files are created while workers run and removed when workers exit, for both Claude and Cursor worker paths.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/daemon/pid.ts` | Modify | Add platform-worker PID path helper(s) and exported typing for worker process kind |
| `src/platform-worker.ts` | Modify | Write/remove worker PID files during startup/shutdown |
| `tests/integration/platform-worker.test.ts` | Modify | Add PID lifecycle assertions for both worker entrypoints |

## Tests

### Unit Tests
- **File**: `tests/daemon/manager.test.ts`
- **Test**: worker PID paths integrate with maintenance preflight process list
- **Pattern**: Arrange-Act-Assert
- **Coverage**: PID path resolution contract

### Integration Tests
- **Scenario**: starting a platform worker creates role-specific PID file and shutdown removes it
- **Validation**: PID file existence toggles exactly with worker runtime lifecycle

## Acceptance Criteria

### Scenario: Claude worker PID lifecycle
- **Given** a Claude platform worker starts for a project
- **When** initialization completes and the worker later shuts down
- **Then** `platform-worker-claude.pid` SHALL be created while the worker is running
- **And** `platform-worker-claude.pid` SHALL be removed on shutdown

### Scenario: Cursor worker PID lifecycle
- **Given** a Cursor platform worker starts for a project
- **When** initialization completes and the worker later shuts down
- **Then** `platform-worker-cursor.pid` SHALL be created while the worker is running
- **And** `platform-worker-cursor.pid` SHALL be removed on shutdown

### Scenario: Maintenance preflight fidelity
- **Given** maintenance preflight runs while a platform worker is active
- **When** process checks execute
- **Then** active worker PID status SHALL be detectable from its PID file
- **And** stale worker PID files SHALL be cleaned by existing stale PID liveness handling

### Scenario: Validation baseline
- **Given** PID lifecycle implementation and tests are complete
- **When** validation commands run
- **Then** targeted tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run targeted worker + preflight tests
bun test tests/integration/platform-worker.test.ts tests/daemon/manager.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep PID lifecycle symmetric with daemon PID handling in `src/daemon.ts`.
- Ensure shutdown cleanup remains idempotent.
