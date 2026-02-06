# open-mem — Master Plan

**Objective**: Build a persistent memory plugin for OpenCode that captures observations from tool executions, compresses them with AI, stores them in SQLite with FTS5 search, and injects relevant context into new sessions.
**Status**: [ ] Planning
**Created**: 2026-02-06
**Last Updated**: 2026-02-06
**Total Tasks**: 22
**Estimated Effort**: 45-55 hours

---

## User Requirements (Immutable)

| Requirement | Notes |
|---|---|
| OpenCode Plugin (Approach 2) | Write an OpenCode plugin that replicates claude-mem's hook behavior |
| Capture via `tool.execute.after` events | Automatic observation capture on tool executions |
| AI-powered compression of observations | Compress observations using AI |
| SQLite + FTS5 storage | Store sessions and observations in SQLite with FTS5 full-text search |
| Context injection via `session.created` events | Inject relevant context from past sessions into new sessions |
| Search via custom tools or MCP | Provide search capabilities via custom tools or MCP |
| Reuse claude-mem architectural patterns | Worker service, queue-based processing, progressive disclosure |
| Standalone npm-publishable package | The project should be a standalone npm-publishable OpenCode plugin |
| Repo: `/Users/clopca/dev/github/open-mem` | Already created, AGPL-3.0 license |
| Project name: `open-mem` | Explicit naming |

---

## Progress Summary

| Phase | Status | Tasks | Effort | Notes |
|-------|--------|-------|--------|-------|
| Phase 1: Foundation | [ ] | 4 | 5-6h | Scaffolding, types, config + tests |
| Phase 2: Data Layer | [ ] | 4 | 8-10h | SQLite, schema, CRUD, FTS5 + tests |
| Phase 3: AI Pipeline | [ ] | 4 | 8-10h | Compression, summarization, prompts + tests |
| Phase 4: Core Hooks | [ ] | 4 | 8-10h | Tool capture, context inject, events, queue + tests |
| Phase 5: Tools & Integration | [ ] | 3 | 6-8h | Custom tools, plugin entry, wiring + tests |
| Phase 6: Polish | [ ] | 3 | 5-7h | Docs, npm prep, E2E validation + tests |

---

## Execution Strategy

Build bottom-up: foundation and types first, then the data layer (SQLite), then the AI pipeline that processes data, then the hooks that capture and inject data, then the custom tools that expose search, and finally polish for publishing. Each phase builds on the previous, with tests at the end of each phase to validate before moving on.

### Parallel Opportunities
- Tasks 01 and 02 can run in parallel (scaffolding and types are independent)
- Tasks 05 and 06 can run in parallel (schema definition and session CRUD are somewhat independent)
- Tasks 09 and 10 can run in parallel (prompts/parser and compressor are somewhat independent)

### Critical Path
01 → 03 → 05 → 07 → 09 → 11 → 13 → 15 → 17 → 19 → 21 (longest dependency chain through all phases)

### Key Technical Decisions
1. **In-process plugin** — no separate HTTP worker service (OpenCode hooks run in-process)
2. **`bun:sqlite`** — OpenCode plugins run in Bun runtime, use built-in SQLite
3. **Direct Anthropic API** — for AI compression (lighter than claude-agent-sdk)
4. **FTS5 only** — skip vector search for v1
5. **`experimental.chat.system.transform`** — best hook for context injection
6. **In-memory queue with SQLite persistence** — simpler than HTTP-based queue
7. **Batch processing on `session.idle`** — compress observations in bulk

---

## Phase 1: Foundation (5-6h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 1 | open-mem-01 | `01-project-scaffolding.md` | Initialize npm package, tsconfig, build config, .gitignore | impl | [ ] |
| 2 | open-mem-02 | `02-types-and-interfaces.md` | Define all TypeScript types and interfaces | impl | [ ] |
| 3 | open-mem-03 | `03-configuration.md` | Configuration management with defaults and env overrides | impl | [ ] |
| 4 | open-mem-04 | `04-phase-1-tests.md` | Phase 1 tests for types and config | **test** | [ ] |

**Milestone**: Project compiles, types are defined, config loads with defaults
**Test Coverage**: Tasks 02, 03

**Files Created/Modified**:
- `package.json` — npm package configuration
- `tsconfig.json` — TypeScript configuration
- `.gitignore` — git ignore rules
- `src/types.ts` — shared TypeScript types
- `src/config.ts` — configuration management
- `src/index.ts` — stub plugin entry point

---

## Phase 2: Data Layer (8-10h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 5 | open-mem-05 | `05-database-setup.md` | SQLite connection, migrations, lifecycle management | impl | [ ] |
| 6 | open-mem-06 | `06-schema-and-fts5.md` | Table definitions, FTS5 virtual tables, indexes | impl | [ ] |
| 7 | open-mem-07 | `07-crud-operations.md` | Session, observation, summary CRUD + FTS5 queries | impl | [ ] |
| 8 | open-mem-08 | `08-phase-2-tests.md` | Phase 2 tests for database layer | **test** | [ ] |

**Milestone**: Database creates tables, CRUD operations work, FTS5 search returns results
**Test Coverage**: Tasks 05, 06, 07

**Files Created/Modified**:
- `src/db/database.ts` — SQLite connection + migrations
- `src/db/schema.ts` — table definitions + FTS5 setup
- `src/db/sessions.ts` — session CRUD operations
- `src/db/observations.ts` — observation CRUD + FTS5 queries
- `src/db/summaries.ts` — summary CRUD operations

---

## Phase 3: AI Pipeline (8-10h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 9 | open-mem-09 | `09-prompts-and-parser.md` | XML prompt templates and response parser | impl | [ ] |
| 10 | open-mem-10 | `10-ai-compressor.md` | AI observation compression using Anthropic API | impl | [ ] |
| 11 | open-mem-11 | `11-ai-summarizer.md` | AI session summarization | impl | [ ] |
| 12 | open-mem-12 | `12-phase-3-tests.md` | Phase 3 tests for AI pipeline | **test** | [ ] |

**Milestone**: Observations can be compressed into structured data, sessions can be summarized
**Test Coverage**: Tasks 09, 10, 11

**Files Created/Modified**:
- `src/ai/prompts.ts` — XML-based prompt templates
- `src/ai/parser.ts` — XML response parser
- `src/ai/compressor.ts` — AI observation compression
- `src/ai/summarizer.ts` — AI session summarization

---

## Phase 4: Core Hooks (8-10h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 13 | open-mem-13 | `13-queue-processor.md` | In-memory queue with SQLite persistence, batch processing | impl | [ ] |
| 14 | open-mem-14 | `14-tool-capture-hook.md` | `tool.execute.after` handler for observation capture | impl | [ ] |
| 15 | open-mem-15 | `15-context-injection-hook.md` | `experimental.chat.system.transform` for context injection | impl | [ ] |
| 16 | open-mem-16 | `16-phase-4-tests.md` | Phase 4 tests for hooks and queue | **test** | [ ] |

**Milestone**: Tool executions are captured, queued, and processed; context is injected into new sessions
**Test Coverage**: Tasks 13, 14, 15

**Files Created/Modified**:
- `src/queue/types.ts` — queue item types
- `src/queue/processor.ts` — queue processing loop
- `src/hooks/tool-capture.ts` — tool.execute.after handler
- `src/hooks/context-inject.ts` — system.transform handler
- `src/hooks/session-events.ts` — event handler (session.idle, session.created)
- `src/context/builder.ts` — context string builder
- `src/context/progressive.ts` — progressive disclosure logic

---

## Phase 5: Tools & Integration (6-8h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 17 | open-mem-17 | `17-custom-tools.md` | mem-search, mem-save, mem-timeline custom tools | impl | [ ] |
| 18 | open-mem-18 | `18-plugin-entry-point.md` | Plugin entry point wiring all hooks and tools together | impl | [ ] |
| 19 | open-mem-19 | `19-phase-5-tests.md` | Phase 5 tests for tools and integration | **test** | [ ] |

**Milestone**: Plugin exports correct shape, all hooks registered, custom tools functional
**Test Coverage**: Tasks 17, 18

**Files Created/Modified**:
- `src/tools/search.ts` — mem-search custom tool
- `src/tools/save.ts` — mem-save custom tool
- `src/tools/timeline.ts` — mem-timeline custom tool
- `src/index.ts` — plugin entry point (final wiring)

---

## Phase 6: Polish (5-7h)

| Order | Task ID | File | Description | Type | Status |
|-------|---------|------|-------------|------|--------|
| 20 | open-mem-20 | `20-build-and-npm-prep.md` | Build pipeline, npm publishing config, bundling | impl | [ ] |
| 21 | open-mem-21 | `21-documentation.md` | README, usage guide, configuration reference | impl | [ ] |
| 22 | open-mem-22 | `22-phase-6-tests.md` | Phase 6 tests — E2E validation, build verification | **test** | [ ] |

**Milestone**: Package builds, publishes to npm, documentation complete, E2E smoke test passes
**Test Coverage**: Tasks 20, 21

**Files Created/Modified**:
- `package.json` — publishing fields (main, types, files, bin)
- `README.md` — full documentation
- Build output in `dist/`

---

## Dependencies

```
Phase 1 (Foundation):
  01, 02 (parallel) → 03 → 04 (tests)

Phase 2 (Data Layer):
  03 → 05 → 06 → 07 → 08 (tests)

Phase 3 (AI Pipeline):
  02, 07 → 09 → 10 → 11 → 12 (tests)

Phase 4 (Core Hooks):
  07, 10 → 13 → 14 → 15 → 16 (tests)

Phase 5 (Tools & Integration):
  07, 15 → 17 → 18 → 19 (tests)

Phase 6 (Polish):
  18 → 20 → 21 → 22 (tests)
```

---

## Exit Criteria

- [ ] All 22 tasks marked complete
- [ ] All tests passing (`bun test`)
- [ ] Build succeeds (`bun run build`)
- [ ] Plugin loads in OpenCode without errors
- [ ] SQLite database creates and migrates correctly
- [ ] Observations are captured from tool executions
- [ ] AI compression produces structured observations
- [ ] Context injection works via system.transform hook
- [ ] Custom tools (mem-search, mem-save, mem-timeline) are functional
- [ ] Package is npm-publishable (`npm pack` succeeds)
- [ ] README documents installation, configuration, and usage

---

## Files Summary

### Files to Create
| File | Task | Purpose |
|------|------|---------|
| `package.json` | 01 | npm package configuration |
| `tsconfig.json` | 01 | TypeScript configuration |
| `.gitignore` | 01 | git ignore rules |
| `src/index.ts` | 01, 18 | Plugin entry point |
| `src/types.ts` | 02 | Shared TypeScript types |
| `src/config.ts` | 03 | Configuration management |
| `src/db/database.ts` | 05 | SQLite connection + migrations |
| `src/db/schema.ts` | 06 | Table definitions + FTS5 |
| `src/db/sessions.ts` | 07 | Session CRUD |
| `src/db/observations.ts` | 07 | Observation CRUD + FTS5 queries |
| `src/db/summaries.ts` | 07 | Summary CRUD |
| `src/ai/prompts.ts` | 09 | XML prompt templates |
| `src/ai/parser.ts` | 09 | XML response parser |
| `src/ai/compressor.ts` | 10 | AI observation compression |
| `src/ai/summarizer.ts` | 11 | AI session summarization |
| `src/queue/types.ts` | 13 | Queue item types |
| `src/queue/processor.ts` | 13 | Queue processing loop |
| `src/hooks/tool-capture.ts` | 14 | tool.execute.after handler |
| `src/hooks/context-inject.ts` | 15 | system.transform handler |
| `src/hooks/session-events.ts` | 14, 15 | Event handler |
| `src/context/builder.ts` | 15 | Context string builder |
| `src/context/progressive.ts` | 15 | Progressive disclosure logic |
| `src/tools/search.ts` | 17 | mem-search custom tool |
| `src/tools/save.ts` | 17 | mem-save custom tool |
| `src/tools/timeline.ts` | 17 | mem-timeline custom tool |
| `README.md` | 21 | Documentation |

### Files to Modify
| File | Tasks | Changes |
|------|-------|---------|
| `package.json` | 01, 20 | Initial setup, then publishing fields |
| `src/index.ts` | 01, 18 | Stub, then full wiring |

---

## Quick Reference

```
 1. open-mem-01  Project scaffolding              [ ]
 2. open-mem-02  Types and interfaces              [ ]
 3. open-mem-03  Configuration                     [ ]
 4. open-mem-04  Phase 1 tests                     [ ]
 5. open-mem-05  Database setup                    [ ]
 6. open-mem-06  Schema and FTS5                   [ ]
 7. open-mem-07  CRUD operations                   [ ]
 8. open-mem-08  Phase 2 tests                     [ ]
 9. open-mem-09  Prompts and parser                [ ]
10. open-mem-10  AI compressor                     [ ]
11. open-mem-11  AI summarizer                     [ ]
12. open-mem-12  Phase 3 tests                     [ ]
13. open-mem-13  Queue processor                   [ ]
14. open-mem-14  Tool capture hook                 [ ]
15. open-mem-15  Context injection hook             [ ]
16. open-mem-16  Phase 4 tests                     [ ]
17. open-mem-17  Custom tools                      [ ]
18. open-mem-18  Plugin entry point                [ ]
19. open-mem-19  Phase 5 tests                     [ ]
20. open-mem-20  Build and npm prep                [ ]
21. open-mem-21  Documentation                     [ ]
22. open-mem-22  Phase 6 tests                     [ ]
```

**Progress**: 0/22 tasks complete (0%)

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `experimental.*` hooks change in future OpenCode versions | High | Medium | Abstract hook registration, document version compatibility |
| AI compression cost (1 API call per observation) | Medium | High | Batch processing on session.idle, configurable compression threshold |
| `bun:sqlite` portability if OpenCode moves to Node | Medium | Low | Isolate DB layer behind interface, document Bun dependency |
| Context size limits in system prompt | High | Medium | Token budget management, progressive disclosure, configurable limits |
| Privacy concerns with stored observations | High | Medium | Configurable ignore patterns, opt-out per session, data retention policy |
| FTS5 search quality for code-heavy content | Medium | Medium | Tune FTS5 tokenizer, supplement with exact-match queries |
| Anthropic API key management | Medium | Low | Support env var, config file, and OpenCode's built-in key |

---

## References

- claude-mem v9.0.17 architecture (research findings)
- OpenCode Plugin API documentation
- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html
- Anthropic Messages API: https://docs.anthropic.com/en/api/messages
- Bun SQLite documentation: https://bun.sh/docs/api/sqlite
