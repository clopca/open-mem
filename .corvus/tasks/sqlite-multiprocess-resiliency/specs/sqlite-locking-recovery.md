# SQLite Locking and Recovery Specification

## Overview
This specification defines the required SQLite startup, retry, and write-lock behavior to eliminate unsafe recovery and reduce multi-process contention failures.

## Status
- [ ] Draft
- [ ] Review
- [x] Approved

## Terminology
Key terms follow RFC 2119:
- **SHALL/MUST**: absolute requirement
- **SHOULD**: recommendation requiring justification to deviate
- **MAY**: optional behavior

## Traceability

| Requirement | Coverage |
|-------------|----------|
| UR-1 | Sections: Error handling, Retry policy, Failure domains |
| UR-2 | Sections: Startup safety, Recovery constraints |
| UR-6 | Sections: Transaction model, Failure domains |
| UR-7 | Sections: WAL handling, write transactions, retry policy |

## Specification

### Startup Safety

#### Requirements
1. Database initialization SHALL NOT delete `.db`, `-wal`, or `-shm` files during `configure()` recovery.
2. If pragma or extension setup fails, initialization MUST return a structured failure path without destructive filesystem side effects.
3. WAL mode SHALL remain enabled (`PRAGMA journal_mode = WAL`).
4. The system SHOULD preserve `busy_timeout` and bounded retries for transient lock contention.

#### Constraints
- The implementation SHALL treat DB/WAL/SHM as a single atomic SQLite state.
- The system MUST NOT attempt auto-rebuild by deleting active files.

### Write Transaction Model

#### Requirements
1. All mutating SQL SHALL execute inside a write coordination path guarded by advisory lock and `BEGIN IMMEDIATE` semantics.
2. Mutating calls routed through `run`, `exec`, `transaction`, or mutating `get/all` patterns MUST acquire write coordination before executing statements.
3. Read-only statements SHOULD avoid write lock acquisition.
4. The write path SHALL be reentrant for the same process/thread context.

#### Constraints
- The system MUST avoid deadlock when nested writes occur in a single process context.

### Retry and Error Handling

#### Requirements
1. `SQLITE_BUSY` and `SQLITE_LOCKED` SHALL use bounded exponential retry with jitter.
2. `SQLITE_IOERR_*` errors MUST fail fast after small bounded retries and emit actionable diagnostics.
3. Retry loops SHALL cap attempts and MUST NOT spin indefinitely.
4. Error diagnostics SHOULD include operation intent (read/write), attempt count, and SQLite error code.

## Acceptance Scenarios

### Scenario: Configure failure does not delete sidecar files
- **Given** a database path with existing `.db`, `-wal`, and `-shm` files
- **When** configure/setup throws during startup
- **Then** the implementation SHALL return/throw an error without deleting any SQLite files
- **And** logs SHALL indicate non-destructive fail-safe behavior

### Scenario: Mutating write acquires lock before execution
- **Given** concurrent writer processes targeting the same DB
- **When** one process issues a mutating statement
- **Then** it SHALL acquire advisory coordination before executing write SQL
- **And** competing writers SHALL receive bounded retry behavior

### Scenario: IOERR does not trigger destructive auto-recovery
- **Given** an `SQLITE_IOERR_VNODE` failure during write
- **When** retries are exhausted
- **Then** the operation MUST fail with structured error context
- **And** no DB/WAL/SHM file deletion SHALL occur

## Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| Startup recovery mode | Delete sidecars, delete db, fail-safe | Fail-safe | Prevents destructive actions under active handles |
| Write transaction entry | Deferred transaction, `BEGIN IMMEDIATE` | `BEGIN IMMEDIATE` | Acquires write lock early, reducing mid-transaction busy failures |
| IOERR handling | Unlimited retries, bounded retries, immediate fail | Bounded small retries + fail fast | Balances resilience with corruption-safety and operator visibility |

## References
- `src/db/database.ts`
- `tests/db/database.test.ts`
- `.corvus/tasks/sqlite-multiprocess-resiliency/MASTER_PLAN.md`
