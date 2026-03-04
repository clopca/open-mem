# 03. Integrate Locking and BEGIN IMMEDIATE

## Meta
- **ID**: sqlite-multiprocess-resiliency-03
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 1
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-01, sqlite-multiprocess-resiliency-02]
- **Effort**: M (2h)
- **Tags**: [implementation, sqlite, transactions, resilience]
- **Requires UX/DX Review**: false

## Objective
Enforce coordinated write execution in database helpers using advisory lock and `BEGIN IMMEDIATE` semantics for mutating operations.

## Context
Immutable requirements: **UR-1, UR-3, UR-6, UR-7, UR-8**.

The database wrapper currently retries transient errors but does not coordinate write ownership across processes at API boundaries. This task integrates lock-wrapped write paths and ensures early write lock acquisition.

**Related Specs**:
- `specs/sqlite-locking-recovery.md` - Write Transaction Model, Retry and Error Handling
- `specs/process-coordination.md` - Advisory Lock Contract

## Deliverables
- Write-intent routing in `Database` helper methods
- `BEGIN IMMEDIATE` transaction strategy for write transactions
- Mutating SQL detection policy for `get/all` with explicit handling for `RETURNING`

## Implementation Steps

### Step 1: Classify statement intent
Implement safe SQL intent detection for mutating operations (`INSERT`, `UPDATE`, `DELETE`, `REPLACE`, DDL, and `RETURNING`).

### Step 2: Wrap writes with advisory lock scope
Ensure write-intent operations acquire cross-process lock before execution.

### Step 3: Apply `BEGIN IMMEDIATE` for write transactions
Update transaction handling to acquire write lock upfront and reduce mid-transaction `BUSY` failures.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/database.ts` | Modify | Write-intent detection, lock wrapping, `BEGIN IMMEDIATE` transaction behavior |
| `src/db/advisory-lock.ts` | Modify (created in Task 02 create-target) | Final integration hooks from `Database` usage |

## Tests

### Unit Tests
- **File**: `tests/db/database.test.ts`
- **Test**: write helpers acquire coordination path; read helpers do not over-lock
- **Pattern**: Arrange-Act-Assert
- **Coverage**: `run/get/all/exec/transaction` write/read behavior

### Integration Tests
- **Scenario**: concurrent write transaction contention under `BEGIN IMMEDIATE`
- **Validation**: deterministic serialization with bounded retry behavior

## Acceptance Criteria

### Scenario: Write helpers use coordinated path
- **Given** mutating SQL executed via `run`, `exec`, `transaction`, or mutating `get/all`
- **When** operation is invoked
- **Then** write execution SHALL be guarded by advisory lock
- **And** operation SHALL use write-transaction semantics aligned with spec

### Scenario: Write transactions acquire lock early
- **Given** two concurrent write transactions
- **When** they begin
- **Then** transaction entry SHALL use `BEGIN IMMEDIATE` semantics
- **And** one transaction SHALL wait/retry or fail boundedly rather than failing mid-transaction unpredictably

### Scenario: Retry policy remains bounded and safe
- **Given** transient lock errors occur during coordinated write
- **When** retries are attempted
- **Then** retries SHALL remain bounded with jittered backoff
- **And** persistent `SQLITE_IOERR_*` failures SHALL fail fast with diagnostics

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
- Be explicit about statement intent edge cases (`WITH ... UPDATE`, `RETURNING`, pragma writes).
- Avoid broad write-locking for simple read-only queries to preserve throughput.
