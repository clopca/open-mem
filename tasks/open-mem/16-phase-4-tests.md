# 16. Phase 4 Tests

## Meta
- **ID**: open-mem-16
- **Feature**: open-mem
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [open-mem-13, open-mem-14, open-mem-15]
- **Effort**: M (2-3h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 4 implementations: queue processor, tool capture hook, context injection hook, and session events.

## Context
This task creates tests for the following implementation tasks:
- Task 13: Queue processor — batch processing, summarization, timer
- Task 14: Tool capture hook — filtering, enqueuing, session events
- Task 15: Context injection hook — progressive disclosure, context building, injection

## Test Specifications

### Tests for Task 13: Queue Processor

**Source File(s)**: `src/queue/processor.ts`
**Test File**: `tests/queue/processor.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test processBatch processes pending items` | integration | 3 pending messages | 3 observations created | Batch processing |
| `test processBatch skips when already processing` | unit | processing=true | Returns 0 | Mutex |
| `test processBatch resets stale items` | integration | Stale processing item | Item reset to pending | Stale recovery |
| `test processBatch uses fallback on AI failure` | integration | Mocked API failure | Fallback observation created | Fallback |
| `test processBatch marks failed items` | integration | Item that throws | Status=failed, error set | Error handling |
| `test processBatch increments session count` | integration | 1 pending message | Session observation_count++ | Count tracking |
| `test summarizeSession creates summary` | integration | Session with observations | Summary created | Summarization |
| `test summarizeSession skips few observations` | integration | Session with 1 observation | No summary | Threshold |
| `test summarizeSession skips existing summary` | integration | Session with summary | No duplicate | Idempotent |
| `test enqueue creates pending message` | integration | Tool output | Pending message in DB | Enqueue |
| `test start/stop timer` | unit | start() then stop() | Timer created then cleared | Lifecycle |

**Mocking Requirements**:
- `ObservationCompressor`: Mock `compress` and `createFallbackObservation`
- `SessionSummarizer`: Mock `summarize` and `shouldSummarize`

---

### Tests for Task 14: Tool Capture Hook

**Source File(s)**: `src/hooks/tool-capture.ts`, `src/hooks/session-events.ts`
**Test File**: `tests/hooks/capture.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test captures tool output` | unit | Valid tool execution | enqueue called | Basic capture |
| `test filters ignored tools` | unit | tool in ignoredTools | enqueue NOT called | Tool filtering |
| `test filters short output` | unit | Output < minOutputLength | enqueue NOT called | Length filtering |
| `test filters sensitive patterns` | unit | Output matching pattern | enqueue NOT called | Privacy filtering |
| `test ensures session exists` | unit | New sessionID | getOrCreate called | Session tracking |
| `test never throws on error` | unit | Queue throws error | No exception propagated | Error safety |
| `test event handler session.created` | unit | session.created event | Session created | Event handling |
| `test event handler session.idle` | unit | session.idle event | processBatch called | Idle processing |
| `test event handler session.completed` | unit | session.completed event | Summary + markCompleted | Session end |
| `test event handler ignores unknown events` | unit | unknown event type | No action | Unknown events |

**Mocking Requirements**:
- `QueueProcessor`: Mock `enqueue`, `processBatch`, `summarizeSession`
- `SessionRepository`: Mock `getOrCreate`, `updateStatus`, `markCompleted`

---

### Tests for Task 15: Context Injection Hook

**Source File(s)**: `src/hooks/context-inject.ts`, `src/context/builder.ts`, `src/context/progressive.ts`
**Test File**: `tests/context/injection.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test buildProgressiveContext respects token budget` | unit | Budget=100, many items | Items within budget | Token budgeting |
| `test buildProgressiveContext prioritizes summaries` | unit | Summaries + index | Summaries first | Priority |
| `test buildContextString XML format` | unit | Context with data | Valid XML structure | Format |
| `test buildContextString includes mem-search hint` | unit | Any context | Contains "mem-search" | Progressive disclosure hint |
| `test buildCompactContext plain text` | unit | Context with data | Plain text format | Compact format |
| `test context injection appends to system` | unit | Existing system prompts | New entry appended | System transform |
| `test context injection skips when disabled` | unit | contextInjectionEnabled=false | system unchanged | Disabled check |
| `test context injection skips when no data` | unit | Empty project | system unchanged | Empty data |
| `test context injection never throws` | unit | DB throws error | No exception | Error safety |
| `test compaction hook uses reduced budget` | unit | Normal config | Half token budget used | Budget reduction |

**Mocking Requirements**:
- `ObservationRepository`: Mock `getIndex`
- `SessionRepository`: Mock `getRecent`
- `SummaryRepository`: Mock `getBySessionId`

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/queue/processor.test.ts` | 11 tests | Task 13 |
| `tests/hooks/capture.test.ts` | 10 tests | Task 14 |
| `tests/context/injection.test.ts` | 10 tests | Task 15 |

## Implementation Steps

### Step 1: Create test helpers
Set up mock factories for repositories and AI services.

### Step 2: Implement queue processor tests
Use real SQLite for integration tests, mock AI services.

### Step 3: Implement hook tests
Mock all dependencies, test control flow and filtering logic.

### Step 4: Implement context injection tests
Test progressive disclosure logic, context building, and hook behavior.

### Step 5: Run tests and verify

## Acceptance Criteria
- [ ] All test files created as specified
- [ ] All tests from Test Specifications implemented
- [ ] Tests follow AAA pattern (Arrange-Act-Assert)
- [ ] Tests are isolated (no shared state between tests)
- [ ] AI API calls are mocked
- [ ] Hook error safety is verified (no exceptions propagate)
- [ ] All tests pass
- [ ] All validation commands pass

## Validation Commands

```bash
# Run all phase 4 tests
cd /Users/clopca/dev/github/open-mem && bun test tests/queue/ tests/hooks/ tests/context/

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test tests/queue/ tests/hooks/ tests/context/ --verbose
```

## Notes
- Hook tests are critical for safety — verify that errors never propagate
- Queue processor tests should use real SQLite for integration testing
- Context injection tests should verify the XML format is well-structured
- Consider testing edge cases: very large outputs, Unicode content, empty sessions
