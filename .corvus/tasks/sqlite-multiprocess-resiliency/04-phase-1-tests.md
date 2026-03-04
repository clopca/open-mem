# 04. Phase 1 Tests

## Meta
- **ID**: sqlite-multiprocess-resiliency-04
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 1
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-01, sqlite-multiprocess-resiliency-02, sqlite-multiprocess-resiliency-03]
- **Effort**: M (2h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 1 implementations.

## Context
This task creates tests for:
- Task 01: Remove destructive configure recovery
- Task 02: Build advisory lock primitive
- Task 03: Integrate locking and `BEGIN IMMEDIATE`

Immutable requirements covered: **UR-1, UR-2, UR-3, UR-6, UR-7**.

## Tests

### Test Specifications

### Tests for Task 01: Remove destructive configure recovery

**Source File(s)**: `src/db/database.ts`  
**Test File**: `tests/db/database.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_configure_failure_no_file_deletion` | unit | simulated configure failure with existing db/wal/shm files | files still exist | startup is non-destructive |
| `test_no_destructive_recovery_branch` | unit | startup failure path invocation | thrown fail-safe error, no unlink side effects | dangerous recovery removed |

### Tests for Task 02: Build advisory lock primitive

**Source File(s)**: `src/db/advisory-lock.ts` (create-target introduced in Task 02)  
**Test File**: `tests/db/advisory-lock.test.ts` (create-target in this task)

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_lock_single_holder` | unit | two contenders same lock path | one holder at a time | cross-process serialization |
| `test_lock_reentrant_nested` | unit | nested same-process acquisition | no deadlock, balanced release | reentrancy behavior |
| `test_lock_timeout_error_context` | unit | lock wait timeout | structured timeout error | actionable diagnostics |

### Tests for Task 03: Integrate locking and BEGIN IMMEDIATE

**Source File(s)**: `src/db/database.ts`  
**Test File**: `tests/db/database.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_write_helpers_use_coordinated_path` | unit | mutating `run/exec/get/all` calls | lock path invoked | write-intent coordination |
| `test_read_helpers_avoid_unneeded_write_lock` | unit | read-only `get/all` calls | no write lock path | read throughput preservation |
| `test_begin_immediate_under_contention` | integration | two writer transactions | deterministic serialized completion | early write lock acquisition |

**Mocking Requirements**:
- SQLite contention simulation: use temp DB + controlled parallel worker invocations.
- Clock/wait timing: deterministic timeout windows where possible.

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/db/advisory-lock.test.ts` (create-target) | 3+ | Task 02 |
| `tests/db/database.test.ts` | 5+ new/updated | Tasks 01, 03 |

## Implementation Steps

### Step 1: Create/extend test file structure
Add create-target `tests/db/advisory-lock.test.ts` and extend `tests/db/database.test.ts`.

### Step 2: Implement tests for Task 01 and Task 02
Implement startup safety and lock behavior tests using AAA.

### Step 3: Implement tests for Task 03
Add coordinated write and `BEGIN IMMEDIATE` contention tests.

### Step 4: Run tests and verify
Run targeted test files first, then broader DB/queue tests for regression confidence.

## Acceptance Criteria

### Scenario: Phase 1 test coverage exists
- **Given** completed Phase 1 implementation tasks
- **When** Phase 1 tests are executed
- **Then** all specified test cases SHALL exist in test files
- **And** each acceptance criterion from Tasks 01-03 SHALL be covered by at least one test

### Scenario: Tests are deterministic and isolated
- **Given** repeated local test runs
- **When** tests are executed multiple times
- **Then** tests SHALL pass without flaky timing behavior
- **And** tests SHALL clean up temporary DB artifacts

### Scenario: Validation suite passes
- **Given** all new tests are implemented
- **When** validation commands are run
- **Then** target tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run all phase tests
bun test tests/db/advisory-lock.test.ts tests/db/database.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Derive test assertions from acceptance criteria, not from implementation internals.
- Keep process-contention tests bounded to avoid hanging CI.
