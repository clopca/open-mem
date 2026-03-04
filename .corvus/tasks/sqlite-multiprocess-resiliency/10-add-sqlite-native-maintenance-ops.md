# 10. Add SQLite-Native Maintenance Ops

## Meta
- **ID**: sqlite-multiprocess-resiliency-10
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 3
- **Priority**: P2
- **Depends On**: [sqlite-multiprocess-resiliency-09]
- **Effort**: M (2h)
- **Tags**: [implementation, sqlite, maintenance, operations]
- **Requires UX/DX Review**: false

## Objective
Add non-destructive SQLite-native maintenance capabilities (checkpoint/integrity flows) and integrate them into maintenance command paths.

## Context
Immutable requirements: **UR-2, UR-6, UR-7, UR-8**.

Best practice for multi-process SQLite is to use SQLite-native mechanisms rather than filesystem deletion for routine maintenance/recovery. This task adds operational primitives aligned with that model.

**Related Specs**:
- `specs/maintenance-safety.md` - SQLite-Native Maintenance Operations
- `specs/sqlite-locking-recovery.md` - Recovery constraints

## Deliverables
- Database helper methods for checkpoint/integrity checks
- Maintenance CLI commands/subcommands wired to safe operations
- Structured command output for operator diagnostics

## Implementation Steps

### Step 1: Add DB maintenance helpers
Implement helper methods in `src/db/database.ts` for `wal_checkpoint` and integrity checks.

### Step 2: Expose safe maintenance command path
Add/extend maintenance CLI command(s) in `src/maintenance.ts` to call non-destructive operations.

### Step 3: Add diagnostics output
Print actionable status details and failure reasons without deleting files.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/database.ts` | Modify | Add SQLite-native maintenance helper APIs |
| `src/maintenance.ts` | Modify | Expose non-destructive maintenance command flow |

## Tests

### Unit Tests
- **File**: `tests/db/database.test.ts`
- **Test**: checkpoint/integrity helper behavior and error handling
- **Pattern**: Arrange-Act-Assert
- **Coverage**: maintenance helper APIs

### Integration Tests
- **Scenario**: CLI maintenance operation executes with active DB
- **Validation**: command succeeds/fails with structured output and no file deletions

## Acceptance Criteria

### Scenario: SQLite-native maintenance works without deletion
- **Given** a valid SQLite database with WAL mode
- **When** operator runs maintenance checkpoint/integrity command
- **Then** command SHALL execute via SQLite-native operations
- **And** command SHALL NOT delete DB/WAL/SHM files

### Scenario: Maintenance diagnostics are actionable
- **Given** maintenance command encounters an error
- **When** command reports failure
- **Then** output SHALL include operation name and failure reason
- **And** output SHALL provide next-step guidance

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/db/database.test.ts tests/integration/maintenance-cli.test.ts

# Build
bun run build
```

## Notes
- Keep command naming compatible with existing CLI conventions.
- Prefer read-safe operations when daemon/processes are active.
