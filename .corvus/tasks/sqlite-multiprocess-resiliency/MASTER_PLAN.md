# SQLite Multiprocess Resiliency - Master Plan

**Objective**: Eliminate unsafe SQLite recovery paths and harden open-mem for safe, coordinated multi-process access across plugin, daemon, platform workers, and maintenance tooling.
**Status**: [ ] Planning | [ ] In Progress | [x] Complete
**Plan Type**: SPEC_DRIVEN
**Tests Enabled**: true
**Created**: 2026-03-03
**Last Updated**: 2026-03-04
**Total Tasks**: 16
**Estimated Effort**: 38 hours

---

## Immutable User Requirements

| ID | Requirement |
|----|-------------|
| UR-1 | Fix `SQLiteError: disk I/O error` / `SQLITE_IOERR_VNODE` rooted in concurrent uncoordinated access and dangerous recovery |
| UR-2 | Remove/fix dangerous recovery logic in `configure()` that deletes WAL/SHM while active |
| UR-3 | Add cross-process coordination for writes across 5 process types |
| UR-4 | Make platform-worker daemon-aware to stop duplicate work |
| UR-5 | Maintenance CLI must check for running processes before deleting DB |
| UR-6 | Deliver production-quality resiliency, fault tolerance, and concurrent access safety |
| UR-7 | Follow SQLite multi-process best practices; WAL retained; retries/backoff hardened |
| UR-8 | Apply comprehensive fixes across all affected SDE areas |

---

## Specifications

| Spec | Status | Description |
|------|--------|-------------|
| `specs/sqlite-locking-recovery.md` | Approved | SQLite access contract, retry/fail-fast policy, and safe recovery rules |
| `specs/process-coordination.md` | Approved | Cross-process advisory locking, process-role coordination, and daemon signaling |
| `specs/platform-worker-daemon-awareness.md` | Approved | Daemon-aware platform worker behavior and fallback rules |
| `specs/maintenance-safety.md` | Approved | Safe maintenance/reset preflight gates and destructive-operation controls |

**Note**: Review specs before starting implementation tasks. Specs use RFC 2119 language (SHALL/MUST/SHOULD/MAY).

---

## Progress Summary

| Phase | Status | Tasks | Effort | Notes |
|-------|--------|-------|--------|-------|
| Phase 1: SQLite Safety Foundation | [x] | 4 | 8h | Remove destructive startup recovery and add lock primitives + write contract |
| Phase 2: Process Coordination | [x] | 5 | 13h | Coordinate daemon/worker/maintenance behavior across processes |
| Phase 3: Operational Hardening | [x] | 3 | 8h | SQLite-native maintenance operations, docs, and final validation tests |
| Phase 4: UX/DX Gate Remediation | [x] | 4 | 9h | Targeted fixes for PID lifecycle, signal parity, and operational guidance; review-fix iteration complete (commit `9eb43ec`) |

---

## Execution Strategy

Implement spec-first hardening in three steps: (1) make SQLite startup and write paths fail-safe, (2) coordinate all process roles to avoid unbounded concurrent writes and duplicated processing, and (3) enforce safe maintenance workflows with explicit destructive intent. The design keeps WAL mode and bounded retry/backoff while preventing file-level destructive actions during active connections.

### Parallel Opportunities
- No in-phase parallel execution is recommended because Phase 1 and Phase 2 tasks share ownership of `src/db/database.ts`, `src/platform-worker.ts`, `src/daemon/manager.ts`, and `src/daemon/pid.ts`.
- Parallelism can resume only after Phase 2 test completion when file ownership stops overlapping.

### Critical Path
01 -> 02 -> 03 -> 05 -> 06 -> 07 -> 08 -> 09 -> 10 -> 11 -> 12 -> 13 -> 14 -> 15 -> 16

---

## Phase 1: SQLite Safety Foundation (8h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 1 | sqlite-multiprocess-resiliency-01 | `01-remove-destructive-configure-recovery.md` | Replace dangerous startup recovery with fail-safe handling | impl | [x] |
| 2 | sqlite-multiprocess-resiliency-02 | `02-build-advisory-lock-primitive.md` | Add cross-process advisory lock utility with reentrancy | impl | [x] |
| 3 | sqlite-multiprocess-resiliency-03 | `03-integrate-locking-and-begin-immediate.md` | Apply lock + `BEGIN IMMEDIATE` write transaction strategy | impl | [x] |
| 4 | sqlite-multiprocess-resiliency-04 | `04-phase-1-tests.md` | Phase 1 tests | **test** | [x] |

**Milestone**: Database startup and write operations are safe under contention without destructive file deletion.
**Test Coverage**: Tasks 01, 02, 03

**Files Created/Modified**:
- `src/db/database.ts` - startup recovery and write transaction behavior
- `src/db/advisory-lock.ts` - new lock abstraction (create-target in Task 02)
- `tests/db/database.test.ts` - updated safety and transaction tests
- `tests/db/advisory-lock.test.ts` - new lock unit tests (create-target in Task 04)

---

## Phase 2: Process Coordination (13h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 5 | sqlite-multiprocess-resiliency-05 | `05-wire-locks-through-process-roles.md` | Wire lock usage and role metadata through process entrypoints | impl | [x] |
| 6 | sqlite-multiprocess-resiliency-06 | `06-make-platform-worker-daemon-aware.md` | Prevent duplicate processing when daemon is active | impl | [x] |
| 7 | sqlite-multiprocess-resiliency-07 | `07-strengthen-daemon-signaling-and-liveness.md` | Improve daemon signaling/liveness behavior for external workers | impl | [x] |
| 8 | sqlite-multiprocess-resiliency-08 | `08-add-maintenance-preflight-gates.md` | Add maintenance reset safety gates and explicit destructive intent | impl | [x] |
| 9 | sqlite-multiprocess-resiliency-09 | `09-phase-2-tests.md` | Phase 2 tests | **test** | [x] |

**Milestone**: Plugin, daemon, platform workers, and maintenance CLI coordinate safely and avoid duplicate or destructive behavior.
**Test Coverage**: Tasks 05, 06, 07, 08

**Files Created/Modified**:
- `src/platform-worker.ts` - daemon-aware mode switching
- `src/daemon/manager.ts` - cross-process signal/liveness contract
- `src/maintenance.ts` - reset preflight checks
- `src/index.ts` - coordination glue
- `tests/integration/platform-worker.test.ts` - daemon-aware behavior tests
- `tests/daemon/manager.test.ts` - liveness/signal tests
- `tests/integration/maintenance-cli.test.ts` - maintenance safety tests (create-target in Task 09)

---

## Phase 3: Operational Hardening (8h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 10 | sqlite-multiprocess-resiliency-10 | `10-add-sqlite-native-maintenance-ops.md` | Add checkpoint/integrity operations for safe maintenance workflows | impl | [x] |
| 11 | sqlite-multiprocess-resiliency-11 | `11-document-resiliency-contracts.md` | Document resiliency contracts and operational runbooks | impl | [x] |
| 12 | sqlite-multiprocess-resiliency-12 | `12-phase-3-tests.md` | Phase 3 tests | **test** | [x] |

**Milestone**: Maintenance and operational guidance align with safe SQLite multi-process best practices.
**Test Coverage**: Tasks 10, 11

**Files Created/Modified**:
- `src/db/database.ts` - SQLite-native maintenance helpers
- `src/maintenance.ts` - safe command paths
- `README.md` - operational safety guidance
- `tests/db/database.test.ts` - maintenance helper tests
- `tests/integration/maintenance-cli.test.ts` - end-to-end safety flows (extends Task 09 create-target)

---

## Phase 4: UX/DX Gate Remediation (9h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 13 | sqlite-multiprocess-resiliency-13 | `13-add-platform-worker-pid-lifecycle.md` | Add platform-worker PID lifecycle so preflight checks reflect real worker liveness | impl | [x] |
| 14 | sqlite-multiprocess-resiliency-14 | `14-align-daemon-signal-failure-handling.md` | Align daemon signal failure handling between platform-worker and plugin paths | impl | [x] |
| 15 | sqlite-multiprocess-resiliency-15 | `15-update-platform-and-ops-remediation-docs.md` | Add concrete stop/retry guidance and daemon-aware mode expectations in docs | impl | [x] |
| 16 | sqlite-multiprocess-resiliency-16 | `16-phase-4-tests.md` | Phase 4 tests | **test** | [x] |

**Milestone**: UX/DX gate issues are resolved with consistent runtime behavior and operator-facing remediation guidance.
**Test Coverage**: Tasks 13, 14, 15

**Files Created/Modified**:
- `src/platform-worker.ts` - worker PID create/remove lifecycle and consistent daemon signal fallback behavior
- `src/daemon/pid.ts` - PID path helper support for platform workers
- `src/index.ts` - plugin-side daemon signal handling parity hooks (if required)
- `README.md` - stop/retry command sequences and maintenance remediation workflow
- `docs/platforms.md` - daemon-aware worker mode expectations and lifecycle notes
- `docs/troubleshooting.md` - concrete remediation command sequence with daemon-aware expectations
- `tests/integration/platform-worker.test.ts` - PID lifecycle and signal failure fallback tests
- `tests/daemon/manager.test.ts` - daemon signal result parity assertions
- `tests/integration/maintenance-cli.test.ts` - remediation guidance parity tests

---

## Dependencies

```text
Phase 1:
  01 -> 02 -> 03 -> 04 (tests)

Phase 2:
  03 -> 05 -> 06 -> 07 -> 08 -> 09 (tests)
  04 -> 09 (shared test-file ordering: tests/db/database.test.ts)

Phase 3:
  09 -> 10
  10 -> 11
  09, 10, 11 -> 12 (tests)

Phase 4:
  12 -> 13 -> 14 -> 15 -> 16 (tests)
```

---

## Exit Criteria

- [x] All tasks marked complete
- [x] All tests passing
- [x] All acceptance criteria verified
- [x] Build succeeds
- [x] No startup path deletes SQLite DB/WAL/SHM files while any process may hold handles
- [x] Platform workers do not process queue batches when daemon is healthy
- [x] `reset-db` refuses destructive actions when active processes are detected unless explicit force intent is provided
- [x] Platform worker PID files are created on startup and removed on shutdown for both Claude and Cursor workers
- [x] Daemon signal failures trigger consistent queue runtime fallback behavior across plugin and platform-worker paths
- [x] Operations docs provide explicit stop/retry command sequences and daemon-aware mode expectations

---

## Files Summary

### Files to Create
| File | Task | Purpose |
|------|------|---------|
| `src/db/advisory-lock.ts` (create-target) | 02 | Cross-process advisory lock + in-process reentrancy |
| `tests/db/advisory-lock.test.ts` (create-target) | 04 | Unit coverage for lock semantics |
| `tests/integration/maintenance-cli.test.ts` (create-target in Task 09; extended in Task 12) | 09/12 | Maintenance preflight and destructive gate validation |
| `.corvus/tasks/sqlite-multiprocess-resiliency/specs/*.md` | Planning | Formal spec source of truth |

### Files to Modify
| File | Tasks | Changes |
|------|-------|---------|
| `src/db/database.ts` | 01, 02, 03, 05, 10 | Remove destructive recovery, add lock integration hooks, enforce write strategy, propagate role metadata, and add maintenance helpers |
| `src/platform-worker.ts` | 05, 06, 07, 13, 14 | Process-role wiring, daemon-aware runtime behavior, explicit daemon status/signal handling, worker PID lifecycle, and fallback parity |
| `src/daemon/manager.ts` | 06, 07, 08 | Shared daemon status API used by worker and maintenance preflight flows |
| `src/index.ts` | 05, 06, 07, 14 | Coordination integration points and daemon signal failure fallback parity |
| `src/maintenance.ts` | 05, 08, 10 | Process-role metadata wiring, safe reset preflight, and SQLite-native operations |
| `src/daemon/pid.ts` | 07, 08, 13 | Stale PID/liveness helpers plus platform-worker PID path support |
| `tests/db/database.test.ts` | 04, 09, 12 | Expanded DB safety, role-metadata, and maintenance helper assertions |
| `tests/integration/platform-worker.test.ts` | 09, 16 | Daemon-aware worker integration tests including PID lifecycle and fallback parity |
| `README.md` | 11, 15 | Runtime safety and remediation guidance updates |
| `docs/platforms.md` | 15 | Platform worker daemon-aware expectations and operational commands |
| `docs/troubleshooting.md` | 11, 15 | Detailed lock/contention remediation and stop/retry sequences |
| `tests/daemon/manager.test.ts` | 16 | Daemon signal result parity and fallback contract assertions |
| `tests/integration/maintenance-cli.test.ts` | 09, 12, 16 | Reset remediation output and documentation-parity integration assertions |

---

## Quick Reference

```text
 1. sqlite-multiprocess-resiliency-01  Remove destructive configure recovery        [x]
 2. sqlite-multiprocess-resiliency-02  Build advisory lock primitive                [x]
 3. sqlite-multiprocess-resiliency-03  Integrate locking + BEGIN IMMEDIATE          [x]
 4. sqlite-multiprocess-resiliency-04  Phase 1 tests                                [x]
 5. sqlite-multiprocess-resiliency-05  Wire locks through process roles             [x]
 6. sqlite-multiprocess-resiliency-06  Make platform-worker daemon-aware            [x]
 7. sqlite-multiprocess-resiliency-07  Strengthen daemon signaling/liveness         [x]
 8. sqlite-multiprocess-resiliency-08  Add maintenance preflight gates              [x]
 9. sqlite-multiprocess-resiliency-09  Phase 2 tests                                [x]
10. sqlite-multiprocess-resiliency-10  Add SQLite-native maintenance ops            [x]
11. sqlite-multiprocess-resiliency-11  Document resiliency contracts                [x]
12. sqlite-multiprocess-resiliency-12  Phase 3 tests                                [x]
13. sqlite-multiprocess-resiliency-13  Add platform-worker PID lifecycle            [x]
14. sqlite-multiprocess-resiliency-14  Align daemon signal failure handling         [x]
15. sqlite-multiprocess-resiliency-15  Update platform/ops remediation docs         [x]
16. sqlite-multiprocess-resiliency-16  Phase 4 tests                                [x]
```

**Progress**: 16/16 tasks complete (100%)

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Advisory lock implementation deadlocks under reentrant calls | High | Med | Implement per-process reentrancy counters and strict lock acquisition ordering |
| Write-locking integration misclassifies mutating SQL in `get/all` | High | Med | Add SQL intent detection + explicit override options + tests for `RETURNING` queries |
| Daemon-aware worker behavior regresses ingestion throughput | Med | Med | Add integration tests and fallback logic when daemon status is stale |
| Maintenance preflight blocks legitimate emergency recovery | Med | Low | Add explicit `--force` path with warning/confirmation and audit logging |
| Platform-worker PID files leak on abrupt shutdown | Med | Med | Add shutdown hooks, stale cleanup, and PID lifecycle integration tests for both worker entrypoints |
| Signal parity changes introduce duplicate processing paths | High | Low | Lock expected fallback behavior with manager/platform integration tests before merge |
| Docs drift from runtime behavior after remediation update | Med | Med | Add docs-to-CLI parity assertions in maintenance/platform integration tests |

---

## Learnings Log

**Final Validation**: 5a PASS, 5b PASS
**Delivery Outcome**: 16/16 tasks complete with one initial 5b failure resolved via Phase 4 remediation and full re-validation.

### Phase 4c Review-Fix Iteration (2026-03-04)

- **Branch**: `feat/sqlite-multiprocess-resiliency-hardening`
- **Fix Commit**: `9eb43ec` (pushed)
- **Scope**: Review-gap hardening only; no requirements/scope changes.
- **Files touched in cycle**: `src/db/database.ts`, `src/platform-worker.ts`, `src/db/advisory-lock.ts`, `src/daemon/pid.ts`, `tests/db/database.test.ts`, `tests/integration/platform-worker.test.ts`, `tests/daemon/pid.test.ts`
- **Validation Outcome**: Code-quality validation PASS on both targeted test runs and full test suite.

### Reusable Components Created

| Component | Location | Purpose | When to Reuse |
|-----------|----------|---------|---------------|
| Advisory lock primitive with reentrancy | `src/db/advisory-lock.ts` | Coordinates cross-process write access and prevents same-process deadlocks | Any SQLite or file-backed critical section that needs process-safe mutual exclusion |
| Write-intent lock + transaction guardrail | `src/db/database.ts` | Standardizes mutating SQL through lock acquisition and `BEGIN IMMEDIATE` strategy | New mutating DB paths and future command handlers that perform writes |
| Daemon status/signal contract surface | `src/daemon/manager.ts` | Provides deterministic daemon liveness + signal outcomes to callers | Worker/plugin coordination paths and any orchestration entrypoint |
| Platform-worker daemon-aware runtime + PID lifecycle | `src/platform-worker.ts` | Prevents duplicate processing and records worker liveness with cleanup semantics | Additional worker types, background runners, or queue processors |
| PID helper expansion for worker roles | `src/daemon/pid.ts` | Normalizes PID path/lifecycle support across daemon and workers | Future process roles that need lifecycle-aware preflight checks |
| Maintenance safety preflight + SQLite-native ops | `src/maintenance.ts` | Blocks destructive commands when processes are active and provides safe maintenance operations | New maintenance/destructive CLI flows |

### Patterns Discovered

- **Fail-safe over destructive recovery**: Prefer explicit operator-facing failure and remediation guidance over automatic WAL/SHM deletion.
- **Single-writer contract**: Gate all writes behind advisory lock + explicit write-intent detection to avoid implicit concurrent mutators.
- **Daemon-aware worker behavior**: Workers SHOULD switch to non-processing/status-only mode when daemon health is confirmed.
- **Signal-failure parity**: Plugin and platform worker paths MUST share fallback semantics when daemon signaling fails.
- **Ops/docs parity through tests**: Integration assertions that reference remediation output reduce drift between runtime behavior and docs.

### Estimate Accuracy

- **Estimated**: 38h
- **Actual**: ~40h
- **Variance**: +2h (~5%)
- **Reason for variance**: One initial 5b gate failure required targeted remediation and a full validation rerun, then passed.

### Future Recommendations

1. Add a reusable process-lifecycle utility module to centralize PID create/remove + stale cleanup across all current/future workers.
2. Add a dedicated contract test suite for daemon signal result parity so plugin and worker fallback behavior remains locked during refactors.
3. Keep remediation command sequences in docs coupled to CLI output snapshots to preserve operator trust during future maintenance changes.
4. Apply the advisory-lock/write-intent pattern to any newly introduced DB mutators before release, not post-hoc.

---

## References

- Research: SQLite WAL sidecar atomicity and active-handle deletion hazards
- Research: `BEGIN IMMEDIATE` for deterministic writer lock acquisition
- Code: `src/db/database.ts`
- Code: `src/platform-worker.ts`
- Code: `src/maintenance.ts`
- Code: `src/daemon/manager.ts`
