# Maintenance Safety Specification

## Overview
This specification defines safe maintenance and reset behavior, including preflight checks for active processes and explicit destructive intent gating.

## Status
- [ ] Draft
- [ ] Review
- [x] Approved

## Terminology
- **SHALL/MUST**: absolute requirement
- **SHOULD**: strong recommendation
- **MAY**: optional behavior

## Traceability

| Requirement | Coverage |
|-------------|----------|
| UR-2 | Prohibits destructive startup recovery patterns |
| UR-5 | Reset must check active processes before delete |
| UR-6 | Safe failure and operational resilience |
| UR-7 | SQLite-native maintenance best practices |
| UR-8 | CLI and DB-layer comprehensive hardening |

## Specification

### Destructive Maintenance Preconditions

#### Requirements
1. `reset-db` SHALL perform preflight checks for active related processes before deleting DB/WAL/SHM.
2. If active processes are detected, reset MUST fail with non-zero exit code unless explicit force intent is provided.
3. Forced destructive reset SHALL emit a high-visibility warning and list detected process roles/PIDs.
4. Default reset behavior SHALL be safe-by-default and non-destructive when preconditions fail.

### SQLite-Native Maintenance Operations

#### Requirements
1. Non-destructive maintenance flows SHOULD prefer SQLite-native operations (`wal_checkpoint`, integrity checks, backup patterns).
2. Routine recovery SHALL NOT delete DB sidecar files.
3. Maintenance commands MAY expose read-only health diagnostics for operator troubleshooting.

### Operator Experience

#### Requirements
1. CLI output MUST clearly explain why a reset is blocked and how to proceed safely.
2. Error output SHALL include actionable next steps (stop daemon, stop workers, retry).
3. Help text SHOULD document force semantics and associated risk.

## Acceptance Scenarios

### Scenario: Reset blocked when daemon is running
- **Given** a live daemon PID for the target project
- **When** `open-mem-maintenance reset-db --project <path>` runs without force
- **Then** command SHALL fail without deleting DB/WAL/SHM files
- **And** output SHALL identify active process and remediation

### Scenario: Forced reset with explicit intent
- **Given** active processes are detected
- **When** operator runs reset with explicit force flag
- **Then** command MUST print destructive warning and perform deletion
- **And** exit code SHALL indicate success only if deletion completes

### Scenario: Safe non-destructive maintenance operation
- **Given** active processes may exist
- **When** operator runs a SQLite-native maintenance operation
- **Then** command SHALL avoid file deletion
- **And** operation SHALL return structured success/failure output

## Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| Reset preflight strictness | Always allow, warn-only, block-by-default | Block-by-default with explicit force | Prevents accidental destructive actions during active access |
| Maintenance strategy | Filesystem delete, SQLite-native operations | SQLite-native-first | Aligns with SQLite multi-process best practices |

## References
- `src/maintenance.ts`
- `src/daemon/pid.ts`
- `src/daemon/manager.ts`
- `tests/integration/maintenance-cli.test.ts`
