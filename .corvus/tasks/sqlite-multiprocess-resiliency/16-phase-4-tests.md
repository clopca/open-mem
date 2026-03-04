# 16. Phase 4 Tests

## Meta
- **ID**: sqlite-multiprocess-resiliency-16
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-13, sqlite-multiprocess-resiliency-14, sqlite-multiprocess-resiliency-15]
- **Effort**: M (2h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for Phase 4 fixes covering worker PID lifecycle, daemon signal fallback parity, and docs-to-runtime remediation alignment.

## Context
This task creates tests for the following implementation tasks:
- Task 13: Add platform-worker PID lifecycle
- Task 14: Align daemon signal failure handling
- Task 15: Update platform and ops remediation docs

Immutable requirements covered: **UR-4, UR-5, UR-6, UR-8**.

Tests are derived from acceptance criteria and expected behavior outcomes, not implementation internals.

## Tests

### Test Specifications

### Tests for Task 13: Add platform-worker PID lifecycle

**Source File(s)**: `src/platform-worker.ts`, `src/daemon/pid.ts`  
**Test File**: `tests/integration/platform-worker.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_claude_worker_writes_and_removes_pid_file` | integration | run claude worker start + shutdown | `platform-worker-claude.pid` appears then is removed | Claude worker PID lifecycle |
| `test_cursor_worker_writes_and_removes_pid_file` | integration | run cursor worker start + shutdown | `platform-worker-cursor.pid` appears then is removed | Cursor worker PID lifecycle |
| `test_worker_stale_pid_is_cleaned_by_liveness_path` | integration | stale worker pid before maintenance preflight | stale pid reported then removed | maintenance preflight fidelity |

### Tests for Task 14: Align daemon signal failure handling

**Source File(s)**: `src/index.ts`, `src/platform-worker.ts`, `src/daemon/manager.ts`  
**Test File**: `tests/daemon/manager.test.ts`, `tests/integration/platform-worker.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_daemon_signal_failure_states_are_explicit` | unit | no daemon / dead daemon / delivery failure | `ok=false` with stable states | caller fallback contract |
| `test_platform_worker_falls_back_to_in_process_on_signal_failure` | integration | enqueue-only mode + failed signal | queue mode becomes `in-process` | worker fallback contract |
| `test_plugin_enqueue_only_path_falls_back_on_signal_failure` | integration | plugin enqueue callback + failed signal | in-process mode activated | plugin parity with worker behavior |

### Tests for Task 15: Update platform and ops remediation docs

**Source File(s)**: `README.md`, `docs/platforms.md`, `docs/troubleshooting.md`  
**Test File**: `tests/integration/maintenance-cli.test.ts`, `tests/e2e/build.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test_docs_include_stop_retry_force_command_sequence` | integration | read docs + run blocked reset flow | documented sequence present and CLI behavior matches | remediation command clarity |
| `test_platform_docs_define_daemon_aware_modes` | integration | read `docs/platforms.md` | explicit `enqueue-only` and `in-process` expectations | daemon-aware mode docs |
| `test_docs_build_integrity_after_updates` | unit | docs build command | build/test passes | docs quality baseline |

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| none | - | existing test files are extended |

## Files to Modify

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/integration/platform-worker.test.ts` | 4+ lifecycle and fallback tests | Tasks 13, 14 |
| `tests/daemon/manager.test.ts` | 1+ signal contract assertions | Task 14 |
| `tests/integration/maintenance-cli.test.ts` | 2+ docs/remediation parity tests | Task 15 |
| `tests/e2e/build.test.ts` | docs integrity assertion update | Task 15 |

## Implementation Steps

### Step 1: Implement PID lifecycle integration tests
Add role-specific worker startup/shutdown assertions for PID file presence and cleanup.

### Step 2: Implement daemon signal parity tests
Add tests that force signal failure states and verify plugin/worker fallback parity.

### Step 3: Implement docs remediation parity tests
Assert docs include concrete command sequences and daemon-aware mode expectations.

### Step 4: Run phase 4 validation suite
Run all targeted tests plus baseline typecheck/lint/build.

## Acceptance Criteria

### Scenario: PID lifecycle fixes are verified
- **Given** completed PID lifecycle implementation
- **When** Phase 4 test suite runs
- **Then** worker PID lifecycle tests SHALL pass for Claude and Cursor workers
- **And** stale PID handling assertions SHALL pass

### Scenario: Signal parity fixes are verified
- **Given** completed daemon signal fallback alignment
- **When** Phase 4 test suite runs
- **Then** plugin and worker signal-failure fallback tests SHALL pass
- **And** no parity regression SHALL remain between the two paths

### Scenario: Documentation remediation fixes are verified
- **Given** updated README/platform/troubleshooting docs
- **When** docs parity tests run
- **Then** concrete stop/retry/force sequences SHALL be present and consistent with CLI behavior
- **And** daemon-aware mode expectations SHALL be present in platform docs

### Scenario: Validation baseline
- **Given** all Phase 4 tests are implemented
- **When** validation commands run
- **Then** targeted tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run all phase tests
bun test tests/integration/platform-worker.test.ts tests/daemon/manager.test.ts tests/integration/maintenance-cli.test.ts tests/e2e/build.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep tests deterministic with isolated temp project directories.
- Validate behavior contracts and user-facing outcomes, not private implementation details.
