# Architecture

This document describes the internal architecture of open-mem.

## Overview

open-mem is an [OpenCode](https://opencode.ai) plugin that provides persistent memory across coding sessions. It captures tool executions, compresses them into structured observations using AI, and injects relevant context into new sessions.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                       OpenCode                          │
│                                                         │
│  tool.execute.after ────────> [Tool Capture Hook]       │
│                                      │                  │
│                                      v                  │
│                             [Pending Queue]             │
│                                      │                  │
│  session.idle ──────────────> [Queue Processor]         │
│                                      │                  │
│                                      v                  │
│                            [AI Compressor] ──> Anthropic│
│                                      │                  │
│                                      v                  │
│                            [SQLite + FTS5]              │
│                                      │                  │
│  system.transform <──────── [Context Injector]          │
│                                                         │
│  session.compacting <────── [Compaction Hook]           │
│                                                         │
│  mem-search ────────────────> [FTS5 Search]             │
│  mem-save ──────────────────> [Direct Save]             │
│  mem-timeline ──────────────> [Session Query]           │
│  mem-recall ────────────────> [Full Observation Fetch]  │
└─────────────────────────────────────────────────────────┘
```

## Source Layout

```
src/
├── index.ts                 Plugin entry point — wires everything together
├── types.ts                 TypeScript interfaces (Observation, Session, Config, etc.)
├── config.ts                Configuration resolution from env vars + defaults
│
├── db/                      SQLite + FTS5 data layer
│   ├── database.ts          Database connection factory
│   ├── schema.ts            Schema initialization + migrations (v1→v2→v3)
│   ├── observations.ts      Observation CRUD + FTS5 search
│   ├── sessions.ts          Session tracking repository
│   ├── summaries.ts         Session summary storage
│   └── pending.ts           Pending message queue storage
│
├── ai/                      AI compression & summarization
│   ├── compressor.ts        Tool output → structured observation (via Claude)
│   ├── summarizer.ts        Session → narrative summary (via Claude)
│   ├── prompts.ts           System prompts for AI operations
│   └── parser.ts            Response parsing + validation
│
├── hooks/                   OpenCode hook handlers
│   ├── tool-capture.ts      Captures tool executions → pending queue
│   ├── context-inject.ts    Injects memory into system prompt
│   ├── session-events.ts    Handles session lifecycle events
│   └── compaction.ts        Preserves memory during session compaction
│
├── queue/                   Batch processing
│   └── processor.ts         Batches pending observations, triggers compression
│
├── context/                 Context retrieval & formatting
│   ├── builder.ts           Builds the injected context block
│   └── progressive.ts       Token-budget-aware progressive disclosure
│
└── tools/                   Custom MCP tools
    ├── search.ts            mem-search — FTS5 full-text search
    ├── save.ts              mem-save — manual observation creation
    ├── timeline.ts          mem-timeline — session history view
    └── recall.ts            mem-recall — fetch full observation by ID
```

## Data Flow

### 1. Capture Phase

When a tool executes in OpenCode, the `tool.execute.after` hook fires. The hook:

1. Checks if the tool is in the ignore list
2. Strips `<private>` content blocks
3. Redacts sensitive patterns (API keys, tokens, passwords)
4. Validates minimum output length
5. Pushes the raw capture to the pending queue

### 2. Compression Phase

On `session.idle`, the queue processor:

1. Batches pending observations (default: 5 per batch)
2. Sends each batch to Claude for semantic compression
3. Claude returns structured observations with:
   - Type: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change`
   - Title and narrative summary
   - Key facts extracted
   - Concepts/tags for FTS5 indexing
   - Files involved
4. Stores compressed observations in SQLite with FTS5 indexing
5. If no API key is set, falls back to basic metadata extraction

### 3. Retrieval Phase

At session start (`experimental.chat.system.transform`):

1. Queries recent observations within the token budget
2. Builds a progressive disclosure index:
   - Recent observations shown in full (configurable count)
   - Older observations shown as compact index entries (type icon, title, token cost, files)
3. Injects the formatted block into the system prompt

### 4. Session Compaction

When OpenCode compacts a session (`experimental.session.compacting`):

1. Retrieves current session's observations
2. Injects them as context to preserve across the compaction boundary
3. Ensures the agent retains memory of the current session's work

## Database Schema

SQLite with FTS5 for full-text search. Three migrations:

- **v1**: Base tables (observations, sessions, pending_messages, observation_fts)
- **v2**: Session summaries table
- **v3**: Structured summary columns (request, investigated, learned, completed, next_steps)

Key tables:

| Table | Purpose |
|-------|---------|
| `observations` | Compressed observations with metadata |
| `observation_fts` | FTS5 virtual table for full-text search |
| `sessions` | Session tracking (start/end, directory) |
| `session_summaries` | AI-generated session narratives |
| `pending_messages` | Queue of unprocessed tool outputs |

## Plugin Lifecycle

```
plugin(input) called by OpenCode
  │
  ├── resolveConfig() — merge env vars + defaults
  ├── createDatabase() — open/create SQLite
  ├── initializeSchema() — run migrations
  ├── create repositories (session, observation, summary, pending)
  ├── create AI services (compressor, summarizer)
  ├── QueueProcessor.start() — begin batch processing
  │
  └── return hooks:
       ├── tool.execute.after → capture tool outputs
       ├── event → handle session start/end/idle
       ├── system.transform → inject context into system prompt
       ├── session.compacting → preserve memory during compaction
       └── tools → [mem-search, mem-save, mem-timeline, mem-recall]
```

## Key Design Decisions

1. **SQLite + FTS5** — Single-file database with built-in full-text search. No external dependencies.
2. **Progressive disclosure** — Show observation titles/costs in the index, not full content. Agent decides what to fetch.
3. **Batch compression** — Tool outputs are queued and compressed in batches during idle time, not synchronously.
4. **Graceful degradation** — Works without an API key via fallback metadata extraction.
5. **Privacy-first** — `<private>` tags, automatic redaction, and local-only storage by default.
