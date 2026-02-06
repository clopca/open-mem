# 19. Phase 5 Tests

## Meta
- **ID**: open-mem-19
- **Feature**: open-mem
- **Phase**: 5
- **Priority**: P1
- **Depends On**: [open-mem-17, open-mem-18]
- **Effort**: M (2h)
- **Tags**: [tests, phase-tests, unit, integration]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 5 implementations: custom tools and plugin entry point integration.

## Context
This task creates tests for the following implementation tasks:
- Task 17: Custom tools — mem-search, mem-save, mem-timeline
- Task 18: Plugin entry point — initialization, wiring, lifecycle

## Test Specifications

### Tests for Task 17: Custom Tools

**Source File(s)**: `src/tools/search.ts`, `src/tools/save.ts`, `src/tools/timeline.ts`
**Test File**: `tests/tools/tools.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test mem-search returns formatted results` | integration | Query matching observations | Formatted string with results | Search output |
| `test mem-search with type filter` | integration | Query + type="decision" | Only decisions | Type filtering |
| `test mem-search no results` | integration | Query with no matches | "No matching" message | Empty results |
| `test mem-search falls back to summaries` | integration | Query matching only summaries | Summary results | Fallback search |
| `test mem-search handles errors` | integration | DB error | Error message string | Error handling |
| `test mem-save creates observation` | integration | Title, type, narrative | Confirmation message | Save |
| `test mem-save with concepts and files` | integration | Full args | Observation with concepts/files | Optional args |
| `test mem-save increments session count` | integration | Save to session | Count incremented | Count tracking |
| `test mem-timeline shows recent sessions` | integration | Project with sessions | Formatted timeline | Timeline |
| `test mem-timeline session detail` | integration | Specific sessionId | Detailed session view | Detail view |
| `test mem-timeline empty project` | integration | No sessions | "No past sessions" message | Empty state |
| `test all tools have Zod schemas` | unit | Tool definitions | args contain Zod schemas | Schema validation |
| `test all tools return strings` | integration | Various inputs | String return type | Contract |

**Mocking Requirements**: Use real SQLite with test data

---

### Tests for Task 18: Plugin Entry Point

**Source File(s)**: `src/index.ts`
**Test File**: `tests/integration/plugin.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test plugin initializes successfully` | integration | Valid plugin input | Hooks object returned | Initialization |
| `test plugin returns all expected hooks` | integration | Valid input | All 4 hooks present | Hook registration |
| `test plugin returns 3 tools` | integration | Valid input | 3 tools in array | Tool registration |
| `test plugin creates database file` | integration | Temp directory | .open-mem/memory.db exists | DB creation |
| `test plugin works without API key` | integration | No ANTHROPIC_API_KEY | Initializes (with warnings) | Graceful degradation |
| `test plugin re-exports types` | unit | Import from index | Types available | Type exports |

**Mocking Requirements**: Use temp directories, no API key needed

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/tools/tools.test.ts` | 13 tests | Task 17 |
| `tests/integration/plugin.test.ts` | 6 tests | Task 18 |

## Implementation Steps

### Step 1: Create tool tests with real SQLite
Set up a test database with seed data, then test each tool's execute function.

### Step 2: Create plugin integration tests
Test the full plugin initialization flow using temp directories.

### Step 3: Run tests and verify

## Acceptance Criteria
- [ ] All test files created as specified
- [ ] All tests from Test Specifications implemented
- [ ] Tests follow AAA pattern (Arrange-Act-Assert)
- [ ] Tests are isolated
- [ ] Tool tests verify string return type (OpenCode contract)
- [ ] Plugin integration tests use temp directories
- [ ] All tests pass
- [ ] All validation commands pass

## Validation Commands

```bash
# Run all phase 5 tests
cd /Users/clopca/dev/github/open-mem && bun test tests/tools/ tests/integration/

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test tests/tools/ tests/integration/ --verbose
```

## Notes
- Plugin integration tests are the most comprehensive — they test the full initialization flow
- Tool tests should verify both the happy path and error handling
- Use temp directories for plugin tests to avoid polluting the real project
- Clean up temp directories and databases after tests
