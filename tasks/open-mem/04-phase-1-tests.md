# 04. Phase 1 Tests

## Meta
- **ID**: open-mem-04
- **Feature**: open-mem
- **Phase**: 1
- **Priority**: P1
- **Depends On**: [open-mem-01, open-mem-02, open-mem-03]
- **Effort**: S (1-1.5h)
- **Tags**: [tests, phase-tests, unit]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 1 implementations: types validation and configuration management.

## Context
This task creates tests for the following implementation tasks:
- Task 02: Types and interfaces — verify type exports and shapes
- Task 03: Configuration — verify defaults, env loading, validation, path resolution

Tests are designed from acceptance criteria, not implementation details.

## Test Specifications

### Tests for Task 02: Types and Interfaces

**Source File(s)**: `src/types.ts`
**Test File**: `tests/types.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test types are importable` | unit | import all types | No TypeScript errors | Types exist and are exported |
| `test ObservationType values` | unit | Create each type value | All 6 values valid | Observation types match claude-mem schema |
| `test Observation shape` | unit | Create observation object | Object matches interface | All required fields present |
| `test ObservationIndex is subset` | unit | Create index from observation | Index has fewer fields | Progressive disclosure lightweight shape |

**Mocking Requirements**: None — pure type tests

---

### Tests for Task 03: Configuration

**Source File(s)**: `src/config.ts`
**Test File**: `tests/config.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test getDefaultConfig returns defaults` | unit | No input | Config with all default values | Default config has sensible values |
| `test resolveConfig with no overrides` | unit | projectDir only | Config with defaults + resolved dbPath | Defaults work out of the box |
| `test resolveConfig resolves relative dbPath` | unit | projectDir="/tmp/proj" | dbPath="/tmp/proj/.open-mem/memory.db" | Relative path resolution |
| `test resolveConfig preserves absolute dbPath` | unit | override dbPath="/custom/path.db" | dbPath="/custom/path.db" | Absolute paths not modified |
| `test resolveConfig env vars override defaults` | unit | Set OPEN_MEM_MODEL env | Config uses env value | Env var loading works |
| `test resolveConfig overrides beat env vars` | unit | Set env + pass override | Override value wins | Priority: defaults < env < overrides |
| `test resolveConfig picks up ANTHROPIC_API_KEY` | unit | Set ANTHROPIC_API_KEY env | apiKey populated | API key from standard env var |
| `test validateConfig no errors for valid config` | unit | Valid config with API key | Empty error array | Valid config passes |
| `test validateConfig error when compression enabled without key` | unit | compressionEnabled=true, no apiKey | Error about missing key | Missing API key detected |
| `test validateConfig error for low maxContextTokens` | unit | maxContextTokens=100 | Error about minimum | Numeric validation works |
| `test validateConfig error for invalid batchSize` | unit | batchSize=0 | Error about minimum | Numeric validation works |
| `test OPEN_MEM_IGNORED_TOOLS parsing` | unit | Set env "Bash,Read" | ignoredTools=["Bash","Read"] | Comma-separated env parsing |

**Mocking Requirements**:
- `process.env`: Set/unset environment variables per test (use `beforeEach`/`afterEach` to restore)

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/types.test.ts` | 4 tests | Task 02 |
| `tests/config.test.ts` | 12 tests | Task 03 |

## Implementation Steps

### Step 1: Create test file structure
Create test files with proper imports and setup. Use Bun's built-in test runner (`bun:test`).

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
```

### Step 2: Implement type tests
Verify that all types are importable and that creating objects matching the interfaces works without TypeScript errors. These are primarily compile-time checks but can also verify runtime shape.

### Step 3: Implement config tests
Test `resolveConfig`, `validateConfig`, and `getDefaultConfig`. For env var tests, save and restore `process.env` values in `beforeEach`/`afterEach`.

```typescript
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = { ...process.env };
});

afterEach(() => {
  // Restore env
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});
```

### Step 4: Run tests and verify
Execute all tests and ensure they pass.

## Acceptance Criteria
- [ ] `tests/types.test.ts` created with all specified tests
- [ ] `tests/config.test.ts` created with all specified tests
- [ ] All tests follow AAA pattern (Arrange-Act-Assert)
- [ ] Tests are isolated (no shared state between tests)
- [ ] Environment variables are properly saved/restored in config tests
- [ ] All tests pass
- [ ] All validation commands pass

## Validation Commands

```bash
# Run all phase 1 tests
cd /Users/clopca/dev/github/open-mem && bun test tests/types.test.ts tests/config.test.ts

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test tests/ --verbose
```

## Notes
- Tests should be deterministic (no flaky tests)
- Type tests are somewhat unusual — they verify that TypeScript types compile correctly and that runtime objects match expected shapes
- Config tests need careful env var management to avoid test pollution
- Each test should test ONE behavior
- Derive test cases from acceptance criteria in implementation tasks
