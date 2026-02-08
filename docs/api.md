# HTTP API

open-mem includes an HTTP API for the dashboard and programmatic access. The API is served when running with dashboard mode enabled.

## Base URL

The dashboard runs on a local port (shown in OpenCode logs). All endpoints are prefixed with `/v1/` or `/api/`.

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

### List Modes

```
GET /api/modes
```

Returns available configuration presets (balanced, focus, chill).

### Apply Mode

```
POST /api/modes/:id/apply
```

Applies a mode preset to the project config.

## Memory Endpoints

### List Observations

```
GET /v1/memory/observations
```

Returns paginated list of observations.

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

Performs hybrid search across observations.

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

Returns statistics about stored observations, sessions, and database size.

## Runtime Endpoints

### Health Check

```
GET /v1/health
```

Returns runtime health summary including database status, queue state, and provider connectivity.

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
