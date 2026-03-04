# 09. Phase 2 Tests

## Meta
- **ID**: sqlite-multiprocess-resiliency-09
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-04, sqlite-multiprocess-resiliency-05, sqlite-multiprocess-resiliency-06, sqlite-multiprocess-resiliency-07, sqlite-multiprocess-resiliency-08]
- **Effort**: L (3h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 2 process-coordination and maintenance safety implementations.

## Context
This task creates tests for:
- Task 05: Wire locks through process roles
- Task 06: Make platform worker daemon-aware
- Task 07: Strengthen daemon signaling/liveness
- Task 08: Add maintenance preflight gates

Immutable requirements covered: **UR-3, UR-4, UR-5, UR-6, UR-8**.

## Tests

### Test Specifications

### Tests for Task 05: Wire locks through process roles

**Source File(s)**: `src/db/database.ts`, `src/index.ts`, `src/daemon.ts`, `src/platform-worker.ts`, `src/maintenance.ts`  
**Test File**: `tests/db/database.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_role_metadata_plugin` | unit | plugin db init | role=plugin in diagnostics/context | role propagation |
| `test_role_metadata_daemon_worker_maintenance` | unit | daemon/worker/maintenance db init | expected role labels | consistent cross-entrypoint metadata |

### Tests for Task 06: Make platform worker daemon-aware

**Source File(s)**: `src/platform-worker.ts`, `src/runtime/queue-runtime.ts`  
**Test File**: `tests/integration/platform-worker.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_worker_enqueue_only_when_daemon_alive` | integration | running daemon + worker events | ingest succeeds, queue mode enqueue-only | no duplicate local processing |
| `test_worker_fallback_to_in_process` | integration | daemon absent/dead | queue mode in-process | fault tolerant fallback |
| `test_worker_signals_daemon_on_enqueue` | integration | enqueue-only ingest | signal call observed | daemon handoff behavior |

### Tests for Task 07: Strengthen daemon signaling/liveness

**Source File(s)**: `src/daemon/manager.ts`, `src/daemon/pid.ts`  
**Test File**: `tests/daemon/manager.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_signal_result_running` | unit | running daemon | signal result success | explicit signal semantics |
| `test_signal_result_missing_daemon` | unit | missing daemon | signal result no-daemon | deterministic fallback decisions |
| `test_status_stale_pid` | unit | stale pid file | running=false | stale state handling |

### Tests for Task 08: Add maintenance preflight gates

**Source File(s)**: `src/maintenance.ts`  
**Test File**: `tests/integration/maintenance-cli.test.ts` (create-target in this task)

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_reset_blocked_without_force` | integration | active daemon + reset command | non-zero exit, files preserved | safety gate requirement |
| `test_reset_with_force_allows_delete` | integration | active daemon + force reset | warning + successful deletion | explicit destructive intent |
| `test_blocked_output_contains_remediation` | integration | blocked reset output | stop-process instructions present | operator guidance |

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/integration/maintenance-cli.test.ts` (create-target) | 3+ | Task 08 |

## Files to Modify

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/integration/platform-worker.test.ts` | 3+ | Task 06 |
| `tests/daemon/manager.test.ts` | 3+ | Task 07 |
| `tests/db/database.test.ts` | 2+ | Task 05 |

## Implementation Steps

### Step 1: Add process-role and daemon-aware integration tests
Extend platform and daemon test coverage to assert explicit coordination outcomes.

### Step 2: Add maintenance CLI safety tests
Create integration test harness for `open-mem-maintenance reset-db` preflight/force behavior.

### Step 3: Run targeted and grouped suites
Run daemon, platform-worker, and maintenance tests together to catch interaction regressions.

## Acceptance Criteria

### Scenario: Phase 2 acceptance criteria map to tests
- **Given** implemented Tasks 05-08
- **When** Phase 2 test files are reviewed and executed
- **Then** each task acceptance criterion SHALL be covered by at least one test
- **And** coverage SHALL include both success and failure/fallback paths

### Scenario: Multi-process coordination behavior is verified
- **Given** daemon and worker interaction scenarios
- **When** integration tests run
- **Then** duplicate processing SHALL be prevented under healthy daemon conditions
- **And** fallback behavior SHALL preserve ingestion continuity

### Scenario: Maintenance safety gates are enforceable
- **Given** active process preflight conditions
- **When** reset command is executed with and without force
- **Then** behavior SHALL match safety policy exactly
- **And** destructive operations SHALL never occur silently

## Validation Commands

```bash
# Run all phase tests
bun test tests/integration/platform-worker.test.ts tests/daemon/manager.test.ts tests/integration/maintenance-cli.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep integration tests stable by using isolated temp project directories.
- Ensure spawned subprocesses are terminated during cleanup.
