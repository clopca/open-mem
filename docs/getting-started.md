# Getting Started

This guide walks you through installing, configuring, and using open-mem with OpenCode.

## Prerequisites

- [OpenCode](https://opencode.ai) installed and configured
- [Bun](https://bun.sh) >= 1.0

## Installation

```bash
bun add open-mem
```

## Configuration

### 1. Register the Plugin

Add `open-mem` to the `plugin` array in your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["open-mem"]
}
```

> **Note**: If you already have plugins, just append `"open-mem"` to the existing array.

### 2. Enable AI Compression (Optional)

For intelligent compression, configure an AI provider. Google Gemini is the default (free tier):

```bash
# Get a free key at https://aistudio.google.com/apikey
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

Or use Anthropic:

```bash
export OPEN_MEM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export OPEN_MEM_MODEL=claude-sonnet-4-20250514
```

Or use AWS Bedrock (no API key needed — uses AWS credentials):

```bash
export OPEN_MEM_PROVIDER=bedrock
export OPEN_MEM_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0
```

Without this, open-mem still captures observations but uses a basic metadata extractor instead of AI compression.

> **Auto-detection:** open-mem detects your provider from environment variables: `GOOGLE_GENERATIVE_AI_API_KEY` → Google, `ANTHROPIC_API_KEY` → Anthropic, AWS credentials → Bedrock.

### 3. Start OpenCode

```bash
opencode
```

open-mem will automatically:
- Initialize a SQLite database at `.open-mem/memory.db`
- Begin capturing tool executions
- Inject memory context into future sessions

## First Session

Your first session with open-mem will behave normally — there's no memory to inject yet. As you work (reading files, running commands, editing code), open-mem captures each tool execution in the background.

When the session goes idle, captured tool outputs are compressed into structured observations.

## Second Session Onwards

From your second session, you'll see a memory block injected into the system prompt. This gives your agent awareness of past work:

```
🔧 [refactor] Extract pricing logic (~120 tokens) — src/pricing.ts
💡 [discovery] FTS5 requires specific tokenizer config (~85 tokens)
🐛 [bugfix] Fix off-by-one in pagination (~95 tokens) — src/api/list.ts
```

The agent can then use `memory.find` and `memory.get` to fetch full details about any observation.

## Using the Tools

### Search Memory

Ask your agent to search memory naturally:

> "What do we know about the pricing module?"

The agent will use `memory.find` to find relevant observations.

### Save Important Context

Ask the agent to remember something:

> "Remember that we decided to use SQLite instead of PostgreSQL for the local cache."

The agent will use `memory.create` to create a manual observation.

### View Session History

> "Show me what we worked on in recent sessions."

The agent will use `memory.history` to display session history.

### Recall Full Details

> "Get the full details on observation #abc123."

The agent will use `memory.get` to fetch the complete observation.

## Privacy

### Exclude Sensitive Content

Wrap content in `<private>` tags to prevent it from being captured:

```
<private>
API_KEY=sk-prod-super-secret-key
DB_PASSWORD=hunter2
</private>
```

Private blocks are stripped before any processing — they never reach the database or the AI provider.

### Automatic Redaction

open-mem automatically redacts common patterns:
- API keys (`sk-ant-...`, `ghp_...`, `Bearer ...`)
- Passwords and secrets
- Environment variable values matching sensitive patterns

### Keep Data Out of Git

Add `.open-mem/` to your `.gitignore`:

```bash
echo '.open-mem/' >> .gitignore
```

## Configuration Options

All configuration is via environment variables. See the [README](../README.md#configuration) for the full reference.

Common options:

```bash
# Disable AI compression (fully local mode)
export OPEN_MEM_COMPRESSION=false

# Reduce context injection budget
export OPEN_MEM_MAX_CONTEXT_TOKENS=2000

# Ignore noisy tools
export OPEN_MEM_IGNORED_TOOLS=Bash,Glob

# Shorter data retention
export OPEN_MEM_RETENTION_DAYS=30

# Debug logging
export OPEN_MEM_LOG_LEVEL=debug
```

## Troubleshooting

See [README Troubleshooting](../README.md#troubleshooting) for common issues and solutions.

## Next Steps

- [Architecture](./architecture.md) — understand how open-mem works internally
- [Platform Adapter Runbook](./platform-adapter-runbook.md) — adapter ops, compatibility evidence workflow, and release gate troubleshooting
- [MCP Compatibility Matrix](./mcp-compatibility-matrix.md) — current support claims and verification policy
- [CONTRIBUTING.md](../CONTRIBUTING.md) — set up a development environment
- [CHANGELOG.md](../CHANGELOG.md) — see what's changed

## Optional: External Platform Workers

If you want to ingest events from non-OpenCode platforms, enable adapter workers:

```bash
export OPEN_MEM_PLATFORM_CLAUDE_CODE=true
export OPEN_MEM_PLATFORM_CURSOR=true

# start one worker per platform integration
bunx open-mem-claude-code --project /path/to/project
bunx open-mem-cursor --project /path/to/project
```

Workers consume newline-delimited JSON events on stdin and write into the same project memory database.
