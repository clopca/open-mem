# Dashboard

open-mem includes a web dashboard for browsing memory, searching observations, and managing configuration. It runs locally alongside your coding session.

## Enabling the Dashboard

Set the `OPEN_MEM_DASHBOARD` environment variable:

```bash
export OPEN_MEM_DASHBOARD=true
```

The dashboard starts on port `3737` by default. Override it with `OPEN_MEM_DASHBOARD_PORT`:

```bash
export OPEN_MEM_DASHBOARD_PORT=4000
```

Once running, open `http://localhost:3737` in your browser. The dashboard binds to localhost only — no authentication is needed since it never leaves your machine.

## Pages

The dashboard has six pages, each focused on a different aspect of your memory store.

### Timeline

A reverse-chronological feed of all observations. Each entry shows the type, title, importance score, and when it was captured. Use this to review what open-mem recorded during a session or to spot-check compression quality.

### Sessions

Groups observations by coding session. Shows session duration, message count, and which agents were active. Useful for understanding what happened in a past session without reading through raw observations.

### Search

Full-text and semantic search across all observations. Supports filtering by type, date range, and importance. Results are ranked using the same hybrid search (FTS5 + vector + RRF) as the `memory.find` tool.

### Stats

Aggregate metrics: total observations, storage size, compression ratios, token usage over time, and observation type distribution. Gives you a quick read on how much memory is accumulating and how efficiently it's being compressed.

### Operations

Shows the processing queue — pending compressions, active batches, and recent failures. If compression stalls or an AI provider returns errors, this is where you diagnose it.

### Settings

The configuration control plane. Displays the effective config with source metadata (default, config file, or environment variable) for each setting. You can:

- **Preview** a config change to see what would differ before committing it
- **Apply** changes, which writes them to `.open-mem/config.json`
- **Rollback** to a previous configuration if something breaks

The Settings page also exposes folder-context maintenance actions (dry-run, clean, rebuild) for managing AGENTS.md generation.

## Real-Time Updates

The dashboard uses Server-Sent Events (SSE) to stream changes as they happen. When open-mem captures a new tool execution or finishes compressing an observation, it appears in the Timeline and Operations pages without a page refresh.
