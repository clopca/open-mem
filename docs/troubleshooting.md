# Troubleshooting

Common issues and solutions when using open-mem.

## "AI compression enabled but no API key found"

**This is a warning, not an error.** open-mem works without an API key — it falls back to a basic metadata extractor. To enable AI compression, configure a provider:

```bash
# Google Gemini (default — free tier)
# Get a free key at https://aistudio.google.com/apikey
export GOOGLE_GENERATIVE_AI_API_KEY=...

# Or use Anthropic
export OPEN_MEM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...

# Or use AWS Bedrock (no API key needed, uses AWS credentials)
export OPEN_MEM_PROVIDER=bedrock
export OPEN_MEM_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0
```

## Database Errors

If you encounter SQLite errors, the database may be corrupted. Remove it and let open-mem recreate:

```bash
rm -rf .open-mem/
```

::: tip
This deletes all stored observations. If you want to preserve data first, export it:
```
mem-export({ format: "json" })
```
:::

## Context Not Appearing in Sessions

1. **Check plugin is loaded** — look for `[open-mem]` messages in OpenCode logs
2. **Check context injection is enabled** — ensure `OPEN_MEM_CONTEXT_INJECTION` is not set to `false`
3. **Check observations exist** — use the `mem-history` tool
4. **First session has no context** — observations must be captured before they can be injected

## High Memory Usage

If the database grows too large, adjust retention and context settings:

```bash
# Shorter retention period
export OPEN_MEM_RETENTION_DAYS=30

# Smaller context budget
export OPEN_MEM_MAX_CONTEXT_TOKENS=2000
```

You can also check database size via the dashboard stats page or the `/v1/memory/stats` endpoint.

## Provider Errors

### Rate Limiting (429)

If you're hitting rate limits, open-mem will automatically retry with fallback providers if configured:

```bash
export OPEN_MEM_FALLBACK_PROVIDERS=google,anthropic,openai
```

### Authentication Errors (401/403)

Authentication errors are not retried. Check that your API key is valid:

```bash
# Verify your key is set
echo $GOOGLE_GENERATIVE_AI_API_KEY
echo $ANTHROPIC_API_KEY
```

## MCP Server Issues

### "Tools not available"

In strict mode, you must call `initialize` before `tools/list` or `tools/call`. Check your client's MCP initialization flow.

### Protocol Version Mismatch

open-mem defaults to protocol version `2024-11-05`. If your client uses a different version:

```bash
export OPEN_MEM_MCP_PROTOCOL_VERSION=2024-11-05
export OPEN_MEM_MCP_SUPPORTED_PROTOCOLS=2024-11-05
```

## Platform Adapter Issues

### Worker Not Ingesting Events

1. Ensure the adapter is enabled: `OPEN_MEM_PLATFORM_CLAUDE_CODE=true`
2. Check worker health: send `{"command":"health"}` on stdin
3. Verify events are valid JSON, one per line
4. Check for `UNSUPPORTED_EVENT` responses — the event schema may not match

### HTTP Bridge Not Responding

Verify the port is correct and not already in use:

```bash
bunx open-mem-claude-code --project /path --http-port 37877
curl http://localhost:37877/v1/health
```

## Pre-0.7.0 Database Migration

Databases created before v0.7.0 are not automatically migrated to the immutable lineage schema. Reset using:

```bash
bunx open-mem-maintenance reset-db --project /path/to/your/project
```

::: warning
This resets the database schema. Export your data first if you want to preserve it.
:::

## Maintenance CLI

open-mem ships a maintenance tool for database and folder-context operations:

```bash
# Reset the database (deletes all observations)
bunx open-mem-maintenance reset-db --project /path/to/project

# Remove managed sections from all AGENTS.md files
bunx open-mem-maintenance folder-context clean --project /path/to/project

# Regenerate all AGENTS.md files from current memory
bunx open-mem-maintenance folder-context rebuild --project /path/to/project

# Preview changes without applying (works with clean and rebuild)
bunx open-mem-maintenance folder-context rebuild --project /path/to/project --dry-run
```

## Uninstalling

1. Remove `"open-mem"` from the `plugin` array in `~/.config/opencode/opencode.json`
2. Remove the package:
   ```bash
   bun remove open-mem
   ```
3. Optionally, delete stored memory data:
   ```bash
   rm -rf .open-mem/
   ```

## Debug Logging

For detailed diagnostic output:

```bash
export OPEN_MEM_LOG_LEVEL=debug
```

This shows capture events, compression results, search queries, and context injection details.

## Getting Help

- [GitHub Issues](https://github.com/clopca/open-mem/issues) — bug reports and feature requests
- [Contributing Guide](https://github.com/clopca/open-mem/blob/main/CONTRIBUTING.md) — development setup
