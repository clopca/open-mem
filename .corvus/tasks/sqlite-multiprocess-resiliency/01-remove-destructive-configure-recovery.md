# 01. Remove Destructive Configure Recovery

## Meta
- **ID**: sqlite-multiprocess-resiliency-01
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 1
- **Priority**: P1
- **Depends On**: []
- **Effort**: M (2h)
- **Tags**: [implementation, sqlite, resilience, backend]
- **Requires UX/DX Review**: false

## Objective
Replace destructive startup recovery in `Database.configure()` with fail-safe, non-destructive behavior that preserves DB/WAL/SHM files.

## Context
Immutable requirements: **UR-1, UR-2, UR-6, UR-7, UR-8**.

Current `src/db/database.ts` attempts recovery by deleting `-wal`/`-shm`, then deleting the DB file. This violates SQLite multi-process safety when files are active/mapped by other processes. This task removes destructive logic and formalizes fail-safe behavior.

**Related Specs**:
- `specs/sqlite-locking-recovery.md` - Startup Safety, Retry and Error Handling
- `specs/maintenance-safety.md` - Routine recovery must avoid file deletion

## Deliverables
- Non-destructive configure/startup error path in `src/db/database.ts`
- Structured logging for setup failure paths
- Removal or deprecation of destructive helper methods used by configure recovery

## Implementation Steps

### Step 1: Remove destructive recovery branches
Delete `deleteSidecarFiles()` and `deleteDatabaseFiles()` configure fallback path usage.
Ensure `configure()` either succeeds or throws fail-safe with clear context.

### Step 2: Add structured configure failure diagnostics
Add deterministic diagnostics with SQLite code/message when available, and operation stage (`applyPragmas`, `loadExtensions`).

### Step 3: Preserve existing safe pragmas and extension loading behavior
Keep WAL, `busy_timeout`, foreign keys, and extension load behavior while avoiding destructive side effects.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/database.ts` | Modify | Remove destructive configure recovery and add fail-safe diagnostics |

## Tests

### Unit Tests
- **File**: `tests/db/database.test.ts`
- **Test**: configure failure path does not delete `.db`, `-wal`, `-shm`
- **Pattern**: Arrange-Act-Assert
- **Coverage**: `Database.configure`, startup safety behavior

### Integration Tests
- **Scenario**: startup failure during simulated pragma/extension failure
- **Validation**: sidecar and db files remain intact after failure

## Acceptance Criteria

### Scenario: Configure failure preserves SQLite files
- **Given** an existing SQLite DB with `-wal` and `-shm` files
- **When** `Database.configure()` fails during initialization
- **Then** the system SHALL throw a non-destructive startup error
- **And** DB/WAL/SHM files SHALL remain on disk unchanged

### Scenario: No destructive startup recovery branch remains
- **Given** the database startup code path
- **When** initialization errors occur
- **Then** no code path SHALL delete SQLite database or sidecar files
- **And** diagnostics SHALL indicate fail-safe behavior

### Scenario: Baseline pragmas remain configured
- **Given** successful startup
- **When** pragmas are applied
- **Then** WAL mode SHALL remain enabled with configured foreign keys and busy timeout
- **And** startup SHALL complete without destructive actions

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/db/database.test.ts

# Build
bun run build
```

## Notes
- Do not silently swallow startup failures that indicate real I/O damage.
- This task intentionally changes behavior from auto-recovery to fail-safe recovery.
- Keep logs actionable for operators investigating startup failures.
