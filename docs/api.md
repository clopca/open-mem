# HTTP API

open-mem exposes an HTTP API when the [dashboard](/dashboard) is enabled. It serves both the dashboard UI and a programmatic REST API. All endpoints are local-only — the server binds to `localhost` on the configured port.

Use this API when you want to integrate with open-mem outside of MCP tools, or build custom tooling against the observation store.

## Base URL

```
http://localhost:3737
```

The port is configurable via `OPEN_MEM_DASHBOARD_PORT`. Endpoints use `/v1/` for memory and runtime operations, and `/api/` for configuration management.

## Config Control Plane

### Get Config Schema

```
GET /api/config/schema
```

Returns the JSON schema for all configuration fields.

### Get Effective Config

```
GET /api/config/effective
```

Returns the current effective configuration with metadata about the source of each value (default, config file, environment variable, or programmatic override).

### Preview Config Change

```
POST /api/config/preview
Content-Type: application/json

{
  "maxContextTokens": 2000,
  "retentionDays": 30
}
```

Returns what the effective config would look like with the proposed changes, without applying them.

### Apply Config Change

```
PATCH /api/config
Content-Type: application/json

{
  "maxContextTokens": 2000,
  "retentionDays": 30
}
```

Persists the changes to `.open-mem/config.json`.

## Mode Presets

### List Presets

```
GET /v1/modes
```

Returns available configuration presets (balanced, focus, chill) with their config patches.

### Apply Preset

```
POST /v1/modes/:id/apply
```

Applies a mode preset to the project config. See [Configuration — Mode Presets](/configuration#mode-presets) for what each preset changes.

## Workflow Modes

### List Workflow Modes

```
GET /v1/workflow-modes
```

Returns the loaded workflow mode definitions. Each mode specifies observation types, concept vocabulary, entity types for knowledge graph extraction, and relationship types.

## Memory Endpoints

### List Observations

```
GET /v1/memory/observations?limit=50&offset=0&type=decision&sessionId=...&state=current
```

Returns paginated list of observations. The `state` parameter filters by lifecycle: `current` (default), `superseded`, or `tombstoned`.

Response:

```json
{
  "ok": true,
  "observations": [
    {
      "id": "abc-123",
      "type": "decision",
      "title": "Use SQLite for local storage",
      "narrative": "...",
      "concepts": ["sqlite", "architecture"],
      "importance": 4,
      "createdAt": "2026-02-08T10:30:00Z"
    }
  ]
}
```

### Get Observation

```
GET /v1/memory/observations/:id
```

Returns a single observation by ID.

### Create Observation

```
POST /v1/memory/observations
Content-Type: application/json

{
  "title": "Important decision",
  "type": "decision",
  "narrative": "We chose X because Y"
}
```

### Create Revision

```
POST /v1/memory/observations/:id/revisions
Content-Type: application/json

{
  "narrative": "Updated: we changed to Z because of new information"
}
```

### Tombstone Observation

```
POST /v1/memory/observations/:id/tombstone
```

Soft-deletes an observation.

### List Sessions

```
GET /v1/memory/sessions
```

Returns a list of recorded coding sessions.

### Get Session

```
GET /v1/memory/sessions/:id
```

Returns details for a specific session.

### Search Observations

```
GET /v1/memory/search?q=pricing+logic&type=decision&limit=10
```

Performs hybrid search across observations. Returns results with relevance scores and match explanations.

Response:

```json
{
  "ok": true,
  "results": [
    {
      "observation": { "id": "...", "title": "...", "type": "decision", "narrative": "..." },
      "rank": 1,
      "snippet": "...highlighted match...",
      "explain": {
        "strategy": "hybrid",
        "matchedBy": ["fts", "vector"]
      }
    }
  ]
}
```

### Recall by IDs

```
POST /v1/memory/recall
Content-Type: application/json

{
  "ids": ["abc-123", "def-456"]
}
```

### Export Memory

```
POST /v1/memory/export
Content-Type: application/json

{
  "format": "json",
  "type": "decision",
  "limit": 100
}
```

### Import Memory

```
POST /v1/memory/import
Content-Type: application/json

{
  "data": "{...exported JSON...}"
}
```

### Memory Stats

```
GET /v1/memory/stats
```

Returns statistics about the memory store.

Response:

```json
{
  "ok": true,
  "stats": {
    "totalObservations": 142,
    "totalSessions": 23,
    "databaseSizeBytes": 4194304,
    "observationsByType": { "decision": 15, "bugfix": 8, "discovery": 45, "..." : "..." }
  }
}
```

## Runtime Endpoints

### Health Check

```
GET /v1/health
```

Returns runtime health including database status, queue state, and provider connectivity.

### Readiness

```
GET /v1/readiness
```

Returns whether the system is ready to serve memory operations, plus reasons when not ready.

### Diagnostics

```
GET /v1/diagnostics
```

Runs setup diagnostics (provider config, adapter enablement, db path, dashboard config).

### Tools Guide

```
GET /v1/tools/guide
```

Returns canonical tool workflow guidance and contract metadata.

### Queue Status

```
GET /v1/queue
```

Operator endpoint for queue state. Localhost access only.

### Trigger Queue Processing

```
POST /v1/queue/process
```

Triggers one queue processing batch. Localhost access only.

Response:

```json
{
  "ok": true,
  "status": "healthy",
  "database": { "connected": true, "sizeBytes": 4194304 },
  "queue": { "pending": 0, "processing": 0 },
  "provider": { "name": "google", "configured": true }
}
```

### Metrics

```
GET /v1/metrics
```

Returns runtime metrics and queue diagnostics including throughput counters, processing times, and error rates.

## Platform Endpoints

### Platform Capabilities

```
GET /v1/platforms
```

Returns platform adapter capabilities and enabled state for OpenCode, Claude Code, and Cursor.

## Maintenance Endpoints

### Folder Context Dry Run

```
POST /v1/maintenance/folder-context/dry-run
```

Shows what AGENTS.md changes would be made without applying them.

### Clean Folder Context

```
POST /v1/maintenance/folder-context/clean
```

Removes managed sections from all AGENTS.md files.

### Rebuild Folder Context

```
POST /v1/maintenance/folder-context/rebuild
```

Regenerates all AGENTS.md files from current memory.

## SSE Events

```
GET /v1/events
```

Server-Sent Events stream for real-time dashboard updates. Emits events for new observations, processing progress, and config changes.
