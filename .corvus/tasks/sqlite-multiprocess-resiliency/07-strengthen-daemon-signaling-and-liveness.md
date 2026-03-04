# 07. Strengthen Daemon Signaling and Liveness

## Meta
- **ID**: sqlite-multiprocess-resiliency-07
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-05, sqlite-multiprocess-resiliency-06]
- **Effort**: M (2h)
- **Tags**: [implementation, daemon, reliability]
- **Requires UX/DX Review**: false

## Objective
Harden daemon manager signaling/liveness APIs so external processes can reliably coordinate work dispatch and detect stale daemon state.

## Context
Immutable requirements: **UR-3, UR-4, UR-6, UR-8**.

Current daemon manager behavior is mostly process-local. Platform workers and maintenance safety paths need robust status checks and well-defined signal failure semantics.

**Related Specs**:
- `specs/process-coordination.md` - Daemon/Worker Coordination
- `specs/platform-worker-daemon-awareness.md` - Health and Observability

## Deliverables
- Stable daemon status API for external callers
- Explicit signal result semantics (success/failure/no-daemon)
- Stale PID cleanup behavior improvements where appropriate

## Implementation Steps

### Step 1: Formalize status/signal responses
Return typed result objects for status and signal calls rather than silent no-op behavior.

### Step 2: Improve stale daemon detection
Ensure stale PID handling is deterministic and consistent with process liveness checks.

### Step 3: Integrate status API into worker and maintenance flows
Update callsites to consume explicit status/signal outcomes.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/daemon/manager.ts` | Modify | Add/adjust status and signal result contract |
| `src/daemon/pid.ts` | Modify | Optional stale PID handling utilities |
| `src/platform-worker.ts` | Modify | Consume explicit daemon signal/status outcomes |

## Tests

### Unit Tests
- **File**: `tests/daemon/manager.test.ts`
- **Test**: status and signal responses for alive/dead/missing daemon states
- **Pattern**: Arrange-Act-Assert
- **Coverage**: daemon lifecycle and IPC behavior

### Integration Tests
- **Scenario**: stale PID file with dead process
- **Validation**: status reports non-running and does not falsely assume daemon health

## Acceptance Criteria

### Scenario: Signal semantics are explicit
- **Given** caller attempts to signal daemon
- **When** daemon is running, missing, or dead
- **Then** API SHALL return explicit status for each case
- **And** callers SHALL be able to decide fallback behavior deterministically

### Scenario: Stale PID does not imply healthy daemon
- **Given** PID file exists for dead process
- **When** daemon status is queried
- **Then** daemon SHALL be reported as not running
- **And** stale state SHALL not block safe fallback logic

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/daemon/manager.test.ts tests/daemon/ipc.test.ts

# Build
bun run build
```

## Notes
- Keep backward compatibility where practical, but prefer explicit contracts over silent no-op behavior.
