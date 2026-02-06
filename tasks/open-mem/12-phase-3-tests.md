# 12. Phase 3 Tests

## Meta
- **ID**: open-mem-12
- **Feature**: open-mem
- **Phase**: 3
- **Priority**: P1
- **Depends On**: [open-mem-09, open-mem-10, open-mem-11]
- **Effort**: M (2h)
- **Tags**: [tests, phase-tests, unit]
- **Requires UX/DX Review**: false

## Objective
Write comprehensive tests for all Phase 3 implementations: prompts, XML parser, AI compressor, and AI summarizer.

## Context
This task creates tests for the following implementation tasks:
- Task 09: Prompts and parser — XML prompt generation and response parsing
- Task 10: AI compressor — observation compression (mock API calls)
- Task 11: AI summarizer — session summarization (mock API calls)

AI API calls are mocked — these tests verify prompt construction, response parsing, and fallback behavior without making real API calls.

## Test Specifications

### Tests for Task 09: Prompts and Parser

**Source File(s)**: `src/ai/prompts.ts`, `src/ai/parser.ts`
**Test File**: `tests/ai/parser.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test buildCompressionPrompt includes tool name` | unit | toolName="Read" | Prompt contains "Read" | Prompt construction |
| `test buildCompressionPrompt includes tool output` | unit | toolOutput="file contents" | Prompt contains output | Prompt construction |
| `test buildCompressionPrompt optional session context` | unit | With/without context | Context included/excluded | Optional context |
| `test buildSummarizationPrompt includes observations` | unit | 3 observations | All titles in prompt | Prompt construction |
| `test parseObservationResponse valid XML` | unit | Well-formed XML | All fields extracted | Happy path parsing |
| `test parseObservationResponse extracts all facts` | unit | XML with 3 facts | Array of 3 facts | Array extraction |
| `test parseObservationResponse extracts all concepts` | unit | XML with concepts | Array of concepts | Array extraction |
| `test parseObservationResponse extracts files` | unit | XML with file paths | filesRead and filesModified arrays | File extraction |
| `test parseObservationResponse invalid type defaults to discovery` | unit | type="unknown" | type="discovery" | Type validation |
| `test parseObservationResponse malformed XML returns null` | unit | "not xml at all" | null | Error handling |
| `test parseObservationResponse missing tags use defaults` | unit | XML with only type+title | Empty arrays, empty strings | Default values |
| `test parseSummaryResponse valid XML` | unit | Well-formed summary XML | All fields extracted | Happy path |
| `test parseSummaryResponse malformed returns null` | unit | Invalid XML | null | Error handling |
| `test estimateTokens rough accuracy` | unit | Known text | ~expected token count | Token estimation |

**Mocking Requirements**: None — pure function tests

---

### Tests for Task 10: AI Compressor

**Source File(s)**: `src/ai/compressor.ts`
**Test File**: `tests/ai/compressor.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test compress returns null when disabled` | unit | compressionEnabled=false | null | Disabled check |
| `test compress returns null for short output` | unit | Output < minOutputLength | null | Min length check |
| `test compress truncates very long output` | unit | 100K char output | API called with truncated text | Truncation |
| `test compress calls Anthropic API` | unit | Valid input (mocked API) | ParsedObservation | API integration |
| `test compress handles API error` | unit | API throws error | null (no throw) | Error handling |
| `test compress handles unparseable response` | unit | API returns garbage | null | Parse failure |
| `test createFallbackObservation for Read tool` | unit | toolName="Read" | type="discovery" | Fallback type mapping |
| `test createFallbackObservation for Write tool` | unit | toolName="Write" | type="change" | Fallback type mapping |
| `test createFallbackObservation extracts file paths` | unit | Output with paths | filesRead/filesModified populated | Path extraction |
| `test compressBatch processes items sequentially` | unit | 3 items (mocked API) | 3 results in map | Batch processing |

**Mocking Requirements**:
- `Anthropic` client: Mock `messages.create` to return controlled responses
- Use `bun:test` mock/spy capabilities or manual mock

---

### Tests for Task 11: AI Summarizer

**Source File(s)**: `src/ai/summarizer.ts`
**Test File**: `tests/ai/summarizer.test.ts`

| Test Name | Type | Input | Expected Output | Validates |
|-----------|------|-------|-----------------|-----------|
| `test summarize returns null for empty observations` | unit | [] | null | Empty check |
| `test summarize falls back when disabled` | unit | compressionEnabled=false | Fallback summary | Disabled fallback |
| `test summarize calls API with observations` | unit | 3 observations (mocked) | ParsedSummary | API integration |
| `test summarize falls back on API error` | unit | API throws | Fallback summary | Error fallback |
| `test createFallbackSummary aggregates files` | unit | Observations with files | All unique files | File aggregation |
| `test createFallbackSummary aggregates concepts` | unit | Observations with concepts | All unique concepts | Concept aggregation |
| `test createFallbackSummary collects decisions` | unit | Observations with decisions | Decision titles | Decision collection |
| `test shouldSummarize false for < 2 observations` | unit | count=1 | false | Threshold check |
| `test shouldSummarize true for >= 2 observations` | unit | count=2 | true | Threshold check |

**Mocking Requirements**:
- `Anthropic` client: Mock `messages.create`

---

## Files to Create

| Test File | Tests | For Task |
|-----------|-------|----------|
| `tests/ai/parser.test.ts` | 14 tests | Task 09 |
| `tests/ai/compressor.test.ts` | 10 tests | Task 10 |
| `tests/ai/summarizer.test.ts` | 9 tests | Task 11 |

## Implementation Steps

### Step 1: Create parser tests
Test all prompt builders and XML parsers with various inputs including edge cases and malformed XML.

### Step 2: Create compressor tests with mocked Anthropic client
```typescript
import { mock } from "bun:test";

// Mock the Anthropic SDK
const mockCreate = mock(() => Promise.resolve({
  content: [{ type: "text", text: "<observation>...</observation>" }],
}));

// Override the module or inject mock
```

### Step 3: Create summarizer tests with mocked Anthropic client
Similar mocking approach as compressor tests.

### Step 4: Run tests and verify
Execute all tests and ensure they pass.

## Acceptance Criteria
- [ ] All test files created as specified
- [ ] All tests from Test Specifications implemented
- [ ] Tests follow AAA pattern (Arrange-Act-Assert)
- [ ] Tests are isolated (no shared state between tests)
- [ ] Anthropic API calls are mocked (no real API calls in tests)
- [ ] Parser tests cover happy path, edge cases, and malformed input
- [ ] Fallback behavior is tested for both compressor and summarizer
- [ ] All tests pass
- [ ] All validation commands pass

## Validation Commands

```bash
# Run all phase 3 tests
cd /Users/clopca/dev/github/open-mem && bun test tests/ai/

# Run with verbose output
cd /Users/clopca/dev/github/open-mem && bun test tests/ai/ --verbose
```

## Notes
- Mock the Anthropic SDK at the module level or via dependency injection
- Parser tests are the most important — they verify the core data extraction logic
- Compressor/summarizer tests focus on control flow (when to call API, when to fallback) rather than API behavior
- Consider using `bun:test`'s `mock()` for mocking or a simple manual mock pattern
- Each test should test ONE behavior
