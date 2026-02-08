# Memory Tools

open-mem provides 9 MCP tools for interacting with memory. These tools are available in OpenCode, the MCP server, and the HTTP API.

## Overview

| Tool | Purpose |
|---|---|
| [`memory.find`](#memory-find) | Search observations using hybrid search |
| [`memory.create`](#memory-create) | Manually save an observation |
| [`memory.history`](#memory-history) | Browse session timeline |
| [`memory.get`](#memory-get) | Fetch full observation details by ID |
| [`memory.revise`](#memory-revise) | Update an existing observation (immutable revision) |
| [`memory.remove`](#memory-remove) | Soft-delete an observation (tombstone) |
| [`memory.transfer.export`](#memory-transfer-export) | Export memories as JSON |
| [`memory.transfer.import`](#memory-transfer-import) | Import memories from JSON |
| [`memory.help`](#memory-help) | Show workflow guidance |

## Recommended Workflow

```
memory.find → memory.history → memory.get
```

1. **Search** with `memory.find` to discover relevant observations
2. **Browse** with `memory.history` to see session context
3. **Fetch** with `memory.get` to read full details

## memory.find {#memory-find}

Search through past observations and session summaries. Uses hybrid search (FTS5 + vector embeddings) when an embedding-capable provider is configured, or FTS5-only otherwise.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search query — keywords, phrases, or file paths |
| `type` | enum | no | Filter by type: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change` |
| `limit` | number | no | Max results (1–50, default: 10) |

### Example

```
memory.find({ query: "pricing logic", type: "refactor", limit: 5 })
```

Returns matching observations with ID, title, type, relevance score, and associated files.

## memory.create {#memory-create}

Manually save an important observation to memory. Use this for decisions, discoveries, gotchas, or anything the AI should remember across sessions.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Brief title (max 80 chars) |
| `type` | enum | yes | Observation type: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change` |
| `narrative` | string | yes | Detailed description of what to remember |
| `concepts` | string[] | no | Related concepts/tags for search |
| `files` | string[] | no | Related file paths |

### Example

```
memory.create({
  title: "Use SQLite instead of PostgreSQL for local cache",
  type: "decision",
  narrative: "Chose SQLite for zero-dependency local storage. PostgreSQL adds operational complexity that doesn't justify the benefits for a single-user local tool.",
  concepts: ["database", "architecture", "sqlite"],
  files: ["src/db/store.ts"]
})
```

## memory.history {#memory-history}

View a timeline of past coding sessions, or center the view around a specific observation for cross-session navigation.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Number of recent sessions (1–20, default: 5) |
| `sessionId` | string | no | Show details for a specific session |
| `anchor` | string | no | Observation ID to center the timeline around (cross-session view) |
| `depthBefore` | number | no | Observations to show before anchor (0–20, default: 5) |
| `depthAfter` | number | no | Observations to show after anchor (0–20, default: 5) |

### Example

```
// Recent sessions
memory.history({ limit: 5 })

// Anchor around a specific observation
memory.history({ anchor: "abc-123", depthBefore: 3, depthAfter: 3 })
```

## memory.get {#memory-get}

Fetch full observation details by ID. Use after `memory.find` or `memory.history` to get complete narratives, facts, concepts, and file lists.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ids` | string[] | yes | Observation IDs to fetch |
| `limit` | number | no | Maximum number of results (1–50, default: 10) |

### Example

```
memory.get({ ids: ["abc-123", "def-456"] })
```

Returns full observation details including narrative, facts, concepts, files, and metadata.

## memory.revise {#memory-revise}

Update an existing project observation by ID. This is **immutable**: the update creates a new revision and supersedes the previous active revision. The original is preserved for audit history.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Observation ID to update |
| `title` | string | no | Updated title |
| `narrative` | string | no | Updated narrative |
| `type` | enum | no | Updated observation type |
| `concepts` | string[] | no | Updated concepts/tags |
| `importance` | number | no | Updated importance (1–5) |

### Example

```
memory.revise({
  id: "abc-123",
  narrative: "Updated: we switched from SQLite WAL to journal mode due to NFS issues.",
  concepts: ["database", "sqlite", "nfs"]
})
```

## memory.remove {#memory-remove}

Tombstone an existing project observation by ID. This is a **soft delete**: the observation is hidden from default recall/search but retained for lineage tracking.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Observation ID to delete |

### Example

```
memory.remove({ id: "abc-123" })
```

## memory.transfer.export {#memory-transfer-export}

Export project memories (observations and session summaries) as portable JSON for backup or transfer between machines.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `format` | enum | no | Export format (currently `json` only) |
| `type` | enum | no | Filter by observation type |
| `limit` | number | no | Maximum observations to export |

### Example

```
memory.transfer.export({ type: "decision", limit: 100 })
```

## memory.transfer.import {#memory-transfer-import}

Import observations and summaries from a JSON export. Skips duplicates by ID.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `data` | string | yes | JSON string from a `memory.transfer.export` output |

### Example

```
memory.transfer.import({ data: '{"observations": [...], "summaries": [...]}' })
```

## memory.help {#memory-help}

Returns a short workflow guide for using memory tools effectively. No parameters required.

### What It Returns

- The recommended `memory.find` → `memory.history` → `memory.get` workflow
- Write patterns (`memory.create`, `memory.revise`)
- Data management patterns (`memory.transfer.export`, `memory.transfer.import`, `memory.remove`)
- Tips for effective memory usage
