# Platform Adapters

open-mem supports multiple AI coding platforms through a unified adapter architecture.

## OpenCode (Native Plugin)

OpenCode is the primary platform. open-mem runs as a native plugin with full lifecycle integration. See [Getting Started](/getting-started) for installation.

### Hooks

open-mem registers these OpenCode hooks:

| Hook | Purpose |
|---|---|
| `tool.execute.after` | Captures tool outputs as pending observations |
| `chat.message` | Captures user prompts for intent tracking |
| `event` (`session.idle`) | Triggers queue processing |
| `experimental.chat.system.transform` | Injects memory context into system prompt |
| `experimental.session.compacting` | Preserves memory across session compaction |
| `event` (`session.end`) | Generates AGENTS.md files |

## MCP Server Mode

open-mem includes a standalone MCP (Model Context Protocol) server that exposes all memory tools to any MCP-compatible AI client.

### Running the Server

```bash
bunx open-mem-mcp --project /path/to/your/project
```

### Client Configuration

Add to your MCP client config:

```json
{
  "mcpServers": {
    "open-mem": {
      "command": "bunx",
      "args": ["open-mem-mcp", "--project", "/path/to/your/project"]
    }
  }
}
```

### Protocol Details

- **Transport**: stdin/stdout, JSON-RPC 2.0
- **Tools exposed**: `mem-find`, `mem-create`, `mem-history`, `mem-get`, `mem-export`, `mem-import`, `mem-maintenance`, `mem-revise`, `mem-remove`, `mem-help`
- **Lifecycle**: `initialize` → `notifications/initialized` → `tools/list` / `tools/call`
- **Protocol version**: `2024-11-05` (negotiated during initialize)
- **Initialization requirement**: strict (tool calls are rejected until `initialize` + `notifications/initialized`)

## Claude Code Adapter

A dedicated adapter worker for ingesting events from Claude Code.

### Setup

```bash
# Enable the adapter
export OPEN_MEM_PLATFORM_CLAUDE_CODE=true

# Start the worker
bunx open-mem-claude-code --project /path/to/project
```

### Event Format

Each line on stdin must be one JSON event. The worker normalizes Claude Code events into open-mem's shared platform schema.

**Responses:**
- Success: `{"ok":true,"code":"OK","ingested":true}`
- Parse error: `{"ok":false,"code":"INVALID_JSON",...}`
- Schema mismatch: `{"ok":false,"code":"UNSUPPORTED_EVENT",...}`

### Worker Commands

| Command | Purpose |
|---|---|
| `{"command":"flush"}` | Force queue processing |
| `{"command":"health"}` | Get worker queue status |
| `{"command":"shutdown"}` | Request graceful shutdown |

## Cursor Adapter

A dedicated adapter worker for ingesting events from Cursor.

### Setup

```bash
# Enable the adapter
export OPEN_MEM_PLATFORM_CURSOR=true

# Start the worker
bunx open-mem-cursor --project /path/to/project
```

The Cursor adapter uses the same event format and worker commands as the Claude Code adapter.

## HTTP Bridge Mode

Both Claude Code and Cursor adapters support an optional HTTP bridge for environments where stdin/stdout isn't practical:

```bash
bunx open-mem-claude-code --project /path/to/project --http-port 37877
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/events` | Ingest events (same envelope as stdio) |
| `GET` | `/v1/health` | Worker health status |

## Shared Architecture

All platform adapters share the same internal pipeline:

1. **Event normalization** — platform-specific events are converted to a shared schema
2. **Capture pipeline** — normalized events enter the same capture queue as OpenCode hooks
3. **Processing** — AI compression, embedding generation, and storage are identical
4. **Retrieval** — same search, context injection, and tool behavior regardless of source platform

This means observations from any platform are stored in the same database and fully interoperable.

## AGENTS.md Filename

When using Claude Code, you may want the context file to be named `CLAUDE.md` instead of `AGENTS.md`:

```bash
export OPEN_MEM_FOLDER_CONTEXT_FILENAME=CLAUDE.md
```
