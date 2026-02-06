# 22. Phase 6 Tests — E2E Validation

## Meta
- **ID**: open-mem-22
- **Feature**: open-mem
- **Phase**: 6
- **Priority**: P1
- **Depends On**: [open-mem-20, open-mem-21]
- **Effort**: M (2h)
- **Tags**: [tests, phase-tests, e2e, integration]
- **Requires UX/DX Review**: false

## Objective
Write end-to-end validation tests that verify the complete plugin lifecycle: initialization, observation capture, queue processing, context injection, and tool usage.

## Context
This task creates the final validation tests that exercise the full plugin flow. These are not unit tests — they test the integrated system from plugin initialization through to context recall. They also verify the build output and npm package structure.

## Test Specifications

### E2E Plugin Lifecycle Tests

**Test File**: `tests/e2e/lifecycle.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test full lifecycle: capture → process → recall` | e2e | Simulate tool execution | Observation stored and searchable | Complete flow |
| `test plugin initializes with default config` | e2e | Minimal plugin input | Hooks + tools returned | Default init |
| `test tool capture → queue → observation` | e2e | Simulate tool.execute.after | Observation in DB after processBatch | Capture pipeline |
| `test context injection returns past observations` | e2e | Session with observations | System prompt includes context | Context recall |
| `test mem-search finds captured observations` | e2e | Capture + search | Search returns captured data | Search integration |
| `test mem-save creates searchable observation` | e2e | Save + search | Saved observation found | Save integration |
| `test mem-timeline shows session history` | e2e | Multiple sessions | Timeline with all sessions | Timeline integration |
| `test session summarization on completion` | e2e | Session with observations + complete | Summary created | Summarization |

**Mocking Requirements**:
- Mock Anthropic API (use fallback compressor)
- Use temp directories for database

---

### Build Verification Tests

**Test File**: `tests/e2e/build.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test build produces dist/index.js` | build | Run build | File exists | Build output |
| `test build produces dist/index.d.ts` | build | Run build | File exists | Type declarations |
| `test dist/index.js is importable` | build | Import dist | Default export is function | Module format |
| `test npm pack includes expected files` | build | npm pack --dry-run | Only dist/, README, LICENSE | Package contents |

**Mocking Requirements**: None — tests actual build output

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/e2e/lifecycle.test.ts` | 8 tests | Tasks 20, 21 (full integration) |
| `tests/e2e/build.test.ts` | 4 tests | Task 20 |

## Implementation Steps

### Step 1: Create E2E test helper
```typescript
// tests/e2e/helpers.ts
import plugin from "../../src/index";
import { randomUUID } from "crypto";

export async function createTestPlugin() {
  const testDir = `/tmp/open-mem-e2e-${randomUUID()}`;
  
  // Set env to disable AI (use fallback)
  const originalKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  
  const hooks = await plugin({
    client: {},
    project: "test-project",
    directory: testDir,
    worktree: testDir,
    serverUrl: "http://localhost:3000",
    $: {},
  });
  
  return {
    hooks,
    testDir,
    cleanup: () => {
      process.env.ANTHROPIC_API_KEY = originalKey;
      Bun.spawnSync(["rm", "-rf", testDir]);
    },
  };
}
```

### Step 2: Implement lifecycle tests
Simulate the full flow: initialize plugin → trigger tool.execute.after → trigger session.idle → verify observation in DB → verify context injection → verify search tool.

### Step 3: Implement build verification tests
Run `bun run build` and verify output files exist and are importable.

### Step 4: Run all tests
```bash
bun test
```

## Acceptance Criteria
- [ ] All test files created as specified
- [ ] E2E lifecycle test exercises full capture → process → recall flow
- [ ] E2E tests use temp directories (no pollution)
- [ ] Build verification tests confirm dist/ output
- [ ] All tests pass without API key (using fallback compressor)
- [ ] All tests pass
- [ ] `bun test` runs all tests across all phases successfully
- [ ] All validation commands pass

## Validation Commands

```bash
# Run E2E tests
cd /Users/clopca/dev/github/open-mem && bun test tests/e2e/

# Run ALL tests (full suite)
cd /Users/clopca/dev/github/open-mem && bun test

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test --verbose
```

## Notes
- E2E tests should work WITHOUT an Anthropic API key — they use the fallback compressor
- Use temp directories to avoid polluting the real project
- Clean up temp directories after each test
- These tests are the final validation gate — if they pass, the plugin is ready for publishing
- Consider adding a test that simulates multiple sessions to verify cross-session memory
