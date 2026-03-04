# 02. Build Advisory Lock Primitive

## Meta
- **ID**: sqlite-multiprocess-resiliency-02
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 1
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-01]
- **Effort**: M (2h)
- **Tags**: [implementation, sqlite, locking, backend]
- **Requires UX/DX Review**: false

## Objective
Create a reusable cross-process advisory lock utility with in-process reentrancy for coordinated SQLite write access.

## Context
Immutable requirements: **UR-1, UR-3, UR-6, UR-8**.

Multi-process contention currently relies only on SQLite busy timeout/retries. This task introduces explicit advisory locking to coordinate writes across plugin, daemon, two platform workers, and maintenance process roles.

**Related Specs**:
- `specs/process-coordination.md` - Advisory Lock Contract
- `specs/sqlite-locking-recovery.md` - Write Transaction Model

## Deliverables
- New advisory lock module with lock/unlock API and reentrancy support
- Timeout-aware lock acquisition with deterministic error on timeout
- Process-role-aware diagnostics metadata

## Implementation Steps

### Step 1: Implement lock module
Create create-target `src/db/advisory-lock.ts` and introduce the new exported write-lock acquisition API (name decided in this task, e.g. `acquireWriteLock`) plus a scoped execution helper.

### Step 2: Add in-process reentrancy guard
Track nested acquisitions per lock file path to avoid deadlock in nested write calls.

### Step 3: Add timeout + diagnostic surface
Return/throw lock timeout errors with lock path, role, wait duration, and owner metadata where available.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/advisory-lock.ts` | Create (create-target) | Advisory lock acquisition/release and reentrant wrapper |
| `src/db/database.ts` | Modify | Add integration hooks or wiring points for future write lock usage |

## Tests

### Unit Tests
- **File**: `tests/db/advisory-lock.test.ts` (create-target in Task 04)
- **Test**: lock acquisition/release, timeout, reentrant nested acquisition
- **Pattern**: Arrange-Act-Assert
- **Coverage**: lock lifecycle, deterministic timeout behavior

### Integration Tests
- **Scenario**: competing processes contend for same lock file
- **Validation**: lock is serialized and released safely on errors

## Acceptance Criteria

### Scenario: Lock serializes write access
- **Given** two independent processes contending for the same DB lock
- **When** both request lock acquisition
- **Then** only one process SHALL hold lock at a time
- **And** the second process SHALL block or fail on timeout based on configuration

### Scenario: Reentrant write lock does not deadlock
- **Given** a process that already holds the lock
- **When** nested write code acquires the same lock again
- **Then** acquisition SHALL be reentrant
- **And** lock release SHALL occur only after outer scope exits

### Scenario: Lock timeout is explicit and actionable
- **Given** lock wait exceeds configured timeout
- **When** acquisition fails
- **Then** error output SHALL include role, lock path, and wait duration
- **And** the operation SHALL fail without partial write side effects

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests (existing suite at this task stage)
bun test tests/db/database.test.ts

# Build
bun run build
```

## Notes
- Keep implementation portable for Bun runtime on macOS/Linux.
- Prefer scoped APIs to reduce lock leak risk from early returns/exceptions.
