# Getting Started

This guide walks you through installing, configuring, and using open-mem with OpenCode.

## Prerequisites

- [OpenCode](https://opencode.ai) installed and configured
- [Bun](https://bun.sh) >= 1.0

## Installation

```bash
bun add open-mem
```

Or install directly from GitHub:

```bash
bun add github:clopca/open-mem
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

For intelligent compression using Claude, set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without this, open-mem still captures observations but uses a basic metadata extractor instead of AI compression.

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

The agent can then use `mem-search` and `mem-recall` to fetch full details about any observation.

## Using the Tools

### Search Memory

Ask your agent to search memory naturally:

> "What do we know about the pricing module?"

The agent will use `mem-search` to find relevant observations.

### Save Important Context

Ask the agent to remember something:

> "Remember that we decided to use SQLite instead of PostgreSQL for the local cache."

The agent will use `mem-save` to create a manual observation.

### View Session History

> "Show me what we worked on in recent sessions."

The agent will use `mem-timeline` to display session history.

### Recall Full Details

> "Get the full details on observation #abc123."

The agent will use `mem-recall` to fetch the complete observation.

## Privacy

### Exclude Sensitive Content

Wrap content in `<private>` tags to prevent it from being captured:

```
<private>
API_KEY=sk-prod-super-secret-key
DB_PASSWORD=hunter2
</private>
```

Private blocks are stripped before any processing — they never reach the database or the Anthropic API.

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
- [CONTRIBUTING.md](../CONTRIBUTING.md) — set up a development environment
- [CHANGELOG.md](../CHANGELOG.md) — see what's changed
