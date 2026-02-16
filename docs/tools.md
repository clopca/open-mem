# Memory Tools

open-mem exposes 10 memory tools across OpenCode, MCP, and platform adapters.

## Overview

| Tool | Purpose |
|---|---|
| [`mem-find`](#mem-find) | Search observations using hybrid retrieval |
| [`mem-history`](#mem-history) | Browse timeline across sessions |
| [`mem-get`](#mem-get) | Fetch full observation details by ID |
| [`mem-create`](#mem-create) | Save a manual observation |
| [`mem-revise`](#mem-revise) | Create a new immutable revision |
| [`mem-remove`](#mem-remove) | Tombstone an observation |
| [`mem-export`](#mem-export) | Export observations and summaries |
| [`mem-import`](#mem-import) | Import observations and summaries |
| [`mem-maintenance`](#mem-maintenance) | Run folder-context maintenance actions |
| [`mem-help`](#mem-help) | Show memory workflow guidance |

## Recommended Workflow

```text
mem-find -> mem-history -> mem-get
```

1. Run `mem-find` to locate candidate observations.
2. Inspect `mem-history` to understand timeline context.
3. Use `mem-get` to pull complete details when needed.

## mem-find

Search memories by query with optional filters.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search text |
| `scope` | `project \| user \| all` | no | Memory scope (default `project`) |
| `types` | `ObservationType[]` | no | Restrict by observation types |
| `limit` | number | no | Max results `1..50` (default `10`) |
| `cursor` | string | no | Cursor for pagination |
| `include` | object | no | Extra metadata flags (`snippets`, `scores`, `relations`) |

### Example

```js
mem-find({ query: "pricing logic", types: ["refactor"], limit: 5 })
```

## mem-history

Browse recent sessions or center timeline around an anchor observation.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | no | Sessions to return `1..20` (default `5`) |
| `cursor` | string | no | Cursor for pagination |
| `sessionId` | string | no | Restrict to one session |
| `anchor` | string | no | Observation ID anchor |
| `depthBefore` | number | no | Observations before anchor `0..20` (default `5`) |
| `depthAfter` | number | no | Observations after anchor `0..20` (default `5`) |

### Example

```js
mem-history({ anchor: "obs-123", depthBefore: 3, depthAfter: 3 })
```

## mem-get

Fetch full observation records by IDs.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `ids` | string[] | yes | Observation IDs |
| `includeHistory` | boolean | no | Include lineage context (default `false`) |
| `limit` | number | no | Max returned `1..50` (default `10`) |

### Example

```js
mem-get({ ids: ["obs-123", "obs-456"], includeHistory: true })
```

## mem-create

Create a manual observation.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Observation title |
| `type` | `ObservationType` | yes | Observation type |
| `narrative` | string | yes | Long-form detail |
| `concepts` | string[] | no | Concepts/tags |
| `files` | string[] | no | Related files |
| `importance` | number | no | Priority `1..5` |
| `scope` | `project \| user` | no | Target scope (default `project`) |

### Example

```js
mem-create({
  title: "Prefer SQLite for local cache",
  type: "decision",
  narrative: "SQLite keeps deployment local-first with lower ops overhead.",
  concepts: ["architecture", "storage"],
  files: ["src/db/store.ts"]
})
```

## mem-revise

Create a new immutable revision for an observation.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Observation ID to revise |
| `title` | string | no | Updated title |
| `narrative` | string | no | Updated narrative |
| `type` | `ObservationType` | no | Updated type |
| `concepts` | string[] | no | Updated concepts |
| `importance` | number | no | Updated importance `1..5` |
| `reason` | string | no | Revision rationale |

## mem-remove

Tombstone an observation (soft delete).

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Observation ID |
| `reason` | string | no | Deletion reason |

## mem-export

Export project memory as JSON.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `scope` | `project` | no | Export scope (default `project`) |
| `type` | `ObservationType` | no | Filter by type |
| `limit` | number | no | Max observations |
| `format` | `json` | no | Output format (default `json`) |

## mem-import

Import JSON memory payload.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `payload` | string | yes | JSON string from `mem-export` |
| `mode` | `skip \| merge \| replace` | no | Import mode (default `skip`) |

## mem-maintenance

Run folder-context maintenance actions.

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | enum | yes | `folderContextDryRun`, `folderContextClean`, `folderContextRebuild`, or `folderContextPurge` |

## mem-help

No arguments. Returns workflow guidance and tool usage patterns.
