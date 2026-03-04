# 08. Add Maintenance Preflight Gates

## Meta
- **ID**: sqlite-multiprocess-resiliency-08
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-05, sqlite-multiprocess-resiliency-07]
- **Effort**: M (2h)
- **Tags**: [implementation, maintenance, safety, cli]
- **Requires UX/DX Review**: true

## Objective
Enforce `reset-db` preflight checks for active processes and require explicit force intent for destructive deletion.

## Context
Immutable requirements: **UR-2, UR-5, UR-6, UR-7, UR-8**.

`src/maintenance.ts` currently deletes DB/WAL/SHM unconditionally. This is unsafe during active access. This task blocks destructive reset when related processes are alive unless explicit forced intent is provided.

**Related Specs**:
- `specs/maintenance-safety.md` - Destructive Maintenance Preconditions
- `specs/process-coordination.md` - Role-aware process checks

## Deliverables
- Preflight process detection before file deletion
- `--force` (or equivalent explicit intent flag) for destructive reset override
- Clear operator messaging and non-zero exit on blocked reset

## Implementation Steps

### Step 1: Add process preflight checks
Detect daemon and known worker process activity for target project before reset action.

### Step 2: Add explicit destructive override flag
Require operator-supplied force flag to bypass blocking preflight.

### Step 3: Improve CLI output and exit codes
Emit actionable warning/error messages with remediation steps and ensure blocked reset fails.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/maintenance.ts` | Modify | Preflight checks, force-gated reset behavior, improved CLI output |
| `src/daemon/pid.ts` | Modify | Process introspection helpers as needed |
| `src/daemon/manager.ts` | Modify | Reusable status check for maintenance preflight |

## Tests

### Unit Tests
- **File**: `tests/daemon/pid.test.ts`
- **Test**: process alive/dead detection behavior for preflight helper logic
- **Pattern**: Arrange-Act-Assert
- **Coverage**: process liveness primitives

### Integration Tests
- **Scenario**: reset blocked when daemon/worker active without force
- **Validation**: DB files remain; CLI exits non-zero with guidance

## Acceptance Criteria

### Scenario: Reset is blocked by active process preflight
- **Given** related process is active for target project
- **When** `reset-db` runs without explicit force
- **Then** reset SHALL be blocked with non-zero exit code
- **And** database files SHALL remain intact

### Scenario: Explicit force enables destructive reset
- **Given** active process preflight detects running process
- **When** operator runs `reset-db` with explicit force intent
- **Then** command SHALL print a destructive warning
- **And** DB/WAL/SHM deletion SHALL proceed

### Scenario: Guidance is actionable
- **Given** a blocked reset operation
- **When** CLI prints errors
- **Then** output SHALL include remediation steps to stop processes safely
- **And** output SHALL identify which process types were detected

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests (existing suites at this task stage)
bun test tests/daemon/pid.test.ts tests/daemon/manager.test.ts

# Build
bun run build
```

## Notes
- Default behavior must be safe-by-default; force path must be explicit and noisy.
- Keep command help text aligned with new flag semantics.
