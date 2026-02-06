# 08. Phase 2 Tests

## Meta
- **ID**: open-mem-08
- **Feature**: open-mem
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [open-mem-05, open-mem-06, open-mem-07]
- **Effort**: M (2-3h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 2 implementations: database setup, schema/FTS5, and CRUD operations.

## Context
This task creates tests for the following implementation tasks:
- Task 05: Database setup — connection, migrations, WAL mode, lifecycle
- Task 06: Schema and FTS5 — table creation, FTS5 virtual tables, triggers
- Task 07: CRUD operations — session, observation, summary, pending message repositories + FTS5 search

Tests use a temporary in-memory or temp-file SQLite database for isolation.

## Test Specifications

### Tests for Task 05: Database Setup

**Source File(s)**: `src/db/database.ts`
**Test File**: `tests/db/database.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test database creates file at path` | integration | temp path | File exists | Constructor creates DB file |
| `test database creates directory if missing` | integration | nested temp path | Directory + file exist | Auto-creates parent dirs |
| `test WAL mode is enabled` | integration | new DB | PRAGMA returns "wal" | WAL configuration |
| `test foreign keys are enabled` | integration | new DB | PRAGMA returns 1 | FK configuration |
| `test migration runs and tracks` | integration | 1 migration | _migrations has 1 row | Migration tracking |
| `test migration skips already applied` | integration | Run same migration twice | _migrations still has 1 row | Idempotent migrations |
| `test migrations run in order` | integration | 3 migrations out of order | Applied in version order | Ordering |
| `test query helpers work` | integration | INSERT + SELECT | Correct data returned | run, get, all methods |
| `test transaction commits on success` | integration | Transaction with INSERT | Data persisted | Transaction commit |
| `test transaction rolls back on error` | integration | Transaction that throws | Data not persisted | Transaction rollback |
| `test close shuts down cleanly` | integration | close() | No errors | Lifecycle |

**Mocking Requirements**: None — uses real SQLite (temp files)

---

### Tests for Task 06: Schema and FTS5

**Source File(s)**: `src/db/schema.ts`
**Test File**: `tests/db/schema.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test initializeSchema creates all tables` | integration | Fresh DB | 4 core tables exist | Table creation |
| `test initializeSchema creates FTS5 tables` | integration | Fresh DB | 2 FTS5 tables exist | FTS5 creation |
| `test initializeSchema creates indexes` | integration | Fresh DB | Expected indexes exist | Index creation |
| `test initializeSchema is idempotent` | integration | Run twice | No errors, same tables | Idempotent |
| `test observations type CHECK constraint` | integration | Invalid type value | Error thrown | CHECK constraint |
| `test sessions status CHECK constraint` | integration | Invalid status value | Error thrown | CHECK constraint |
| `test FTS5 trigger syncs on INSERT` | integration | Insert observation | FTS5 search finds it | Trigger sync |
| `test FTS5 trigger syncs on DELETE` | integration | Insert then delete | FTS5 search empty | Trigger sync |

**Mocking Requirements**: None — uses real SQLite (temp files)

---

### Tests for Task 07: CRUD Operations

**Source File(s)**: `src/db/sessions.ts`, `src/db/observations.ts`, `src/db/summaries.ts`
**Test File**: `tests/db/crud.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test SessionRepository.create` | integration | sessionId, projectPath | Session object returned | Session creation |
| `test SessionRepository.getById` | integration | Existing ID | Session found | Session retrieval |
| `test SessionRepository.getById not found` | integration | Non-existent ID | null | Missing session |
| `test SessionRepository.getOrCreate existing` | integration | Existing session | Returns existing | Upsert existing |
| `test SessionRepository.getOrCreate new` | integration | New session | Creates and returns | Upsert new |
| `test SessionRepository.updateStatus` | integration | New status | Status updated | Status update |
| `test SessionRepository.markCompleted` | integration | Active session | Status=completed, endedAt set | Completion |
| `test SessionRepository.getRecent` | integration | Multiple sessions | Ordered by started_at DESC | Recent query |
| `test ObservationRepository.create` | integration | Full observation data | Observation with ID | Observation creation |
| `test ObservationRepository.getBySession` | integration | Session with 3 observations | 3 results ordered by created_at | Session observations |
| `test ObservationRepository.search FTS5` | integration | Search "JWT authentication" | Matching observations | FTS5 search |
| `test ObservationRepository.search with type filter` | integration | Search + type="decision" | Only decisions | Filtered search |
| `test ObservationRepository.getIndex` | integration | Multiple observations | Lightweight index entries | Progressive disclosure |
| `test ObservationRepository.searchByConcept` | integration | Concept "authentication" | Matching observations | Concept search |
| `test ObservationRepository.searchByFile` | integration | File path "src/auth.ts" | Matching observations | File search |
| `test SummaryRepository.create` | integration | Summary data | Summary with ID | Summary creation |
| `test SummaryRepository.getBySessionId` | integration | Session with summary | Summary found | Summary retrieval |
| `test SummaryRepository.search FTS5` | integration | Search query | Matching summaries | FTS5 search |
| `test PendingMessageRepository.create` | integration | Message data | Message with pending status | Message creation |
| `test PendingMessageRepository.getPending` | integration | Mix of statuses | Only pending returned | Status filtering |
| `test PendingMessageRepository.markCompleted` | integration | Processing message | Status=completed | Status transition |
| `test PendingMessageRepository.markFailed` | integration | Processing message | Status=failed, error set, retryCount++ | Failure handling |
| `test PendingMessageRepository.resetStale` | integration | Old processing message | Reset to pending | Stale recovery |

**Mocking Requirements**: None — uses real SQLite (temp files)

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/db/database.test.ts` | 11 tests | Task 05 |
| `tests/db/schema.test.ts` | 8 tests | Task 06 |
| `tests/db/crud.test.ts` | 23 tests | Task 07 |

## Implementation Steps

### Step 1: Create test helper for temporary databases
```typescript
// tests/db/helpers.ts
import { createDatabase } from "../../src/db/database";
import { initializeSchema } from "../../src/db/schema";
import { randomUUID } from "crypto";

export function createTestDb() {
  const dbPath = `/tmp/open-mem-test-${randomUUID()}.db`;
  const db = createDatabase({ dbPath });
  initializeSchema(db);
  return { db, dbPath };
}

export function cleanupTestDb(dbPath: string) {
  try { Bun.spawnSync(["rm", "-f", dbPath, `${dbPath}-wal`, `${dbPath}-shm`]); } catch {}
}
```

### Step 2: Implement database tests
Test connection, WAL mode, migrations, query helpers, transactions, and lifecycle.

### Step 3: Implement schema tests
Test table creation, FTS5 tables, indexes, CHECK constraints, and FTS5 trigger sync.

### Step 4: Implement CRUD tests
Test all repository methods. Create test data, verify CRUD operations, and test FTS5 search.

### Step 5: Run tests and verify
Execute all tests and ensure they pass.

## Acceptance Criteria
- [ ] All test files created as specified
- [ ] All tests from Test Specifications implemented
- [ ] Tests follow AAA pattern (Arrange-Act-Assert)
- [ ] Tests are isolated (each test gets a fresh temp database)
- [ ] Temp databases are cleaned up after tests
- [ ] FTS5 search tests verify ranked results
- [ ] All tests pass
- [ ] All validation commands pass

## Validation Commands

```bash
# Run all phase 2 tests
cd /Users/clopca/dev/github/open-mem && bun test tests/db/

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test tests/db/ --verbose
```

## Notes
- Use temp files (not `:memory:`) for SQLite tests since FTS5 triggers may behave differently in-memory
- Each test should create its own database to ensure isolation
- Clean up temp files in `afterEach` or `afterAll`
- FTS5 search tests should verify that results are ranked (more relevant = better rank)
- Test the JSON serialization/deserialization round-trip for array fields
