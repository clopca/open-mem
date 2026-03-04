# 12. Phase 3 Tests

## Meta
- **ID**: sqlite-multiprocess-resiliency-12
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 3
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-09, sqlite-multiprocess-resiliency-10, sqlite-multiprocess-resiliency-11]
- **Effort**: M (3h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write final Phase 3 tests covering SQLite-native maintenance operations and documented resiliency workflows.

## Context
This task creates tests for:
- Task 10: Add SQLite-native maintenance ops
- Task 11: Document resiliency contracts

Immutable requirements covered: **UR-5, UR-6, UR-7, UR-8**.

Tests must validate behavior outcomes (safe maintenance + accurate guidance), not implementation details.

## Tests

### Test Specifications

### Tests for Task 10: Add SQLite-native maintenance ops

**Source File(s)**: `src/db/database.ts`, `src/maintenance.ts`  
**Test File**: `tests/db/database.test.ts`, `tests/integration/maintenance-cli.test.ts` (created in Task 09 create-target)

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_checkpoint_operation_non_destructive` | unit | db with wal files | checkpoint result, files preserved | SQLite-native maintenance behavior |
| `test_integrity_check_reports_status` | unit | healthy/corrupt simulation | structured status output | diagnostics correctness |
| `test_cli_maintenance_non_destructive_flow` | integration | maintenance command execution | success/failure output, no file deletes | safe operational path |

### Tests for Task 11: Document resiliency contracts

**Source File(s)**: `README.md` (and optional docs files)  
**Test File**: `tests/integration/maintenance-cli.test.ts` (created in Task 09 create-target; doc-driven command parity assertions)

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_documented_reset_block_behavior_matches_cli` | integration | blocked reset scenario | output aligned with documented guidance | docs/runtime consistency |
| `test_documented_force_behavior_matches_cli` | integration | force reset scenario | warning + expected destructive behavior | docs/runtime consistency |

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/integration/maintenance-cli.test.ts` (existing from Task 09 create-target) | additional assertions | Tasks 10, 11 |

## Files to Modify

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/db/database.test.ts` | 2+ maintenance helper tests | Task 10 |

## Implementation Steps

### Step 1: Add maintenance helper tests
Extend DB tests for checkpoint/integrity helpers and non-destructive guarantees.

### Step 2: Add CLI parity tests
Validate maintenance command output and behavior against documented guidance.

### Step 3: Run full resilience-focused suite
Run db + daemon + platform-worker + maintenance integration suite for final confidence.

## Acceptance Criteria

### Scenario: SQLite-native maintenance is fully verified
- **Given** implemented maintenance helper and CLI flows
- **When** phase tests run
- **Then** all specified maintenance tests SHALL pass
- **And** no test SHALL depend on destructive file deletion defaults

### Scenario: Documentation and behavior stay aligned
- **Given** documented operational runbook steps
- **When** equivalent integration tests execute
- **Then** observed CLI behavior SHALL match documentation
- **And** divergence SHALL fail tests with clear assertion output

### Scenario: Final quality baseline passes
- **Given** completed feature implementation
- **When** validation commands run
- **Then** targeted tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run all phase tests
bun test tests/db/database.test.ts tests/integration/maintenance-cli.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep failure messages actionable; these tests are release-gate level for this feature.
- Favor deterministic temp-path isolation over shared filesystem fixtures.
