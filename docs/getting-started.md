# Getting Started

This guide walks you through installing, configuring, and using open-mem with OpenCode.

## Prerequisites

- [OpenCode](https://opencode.ai) installed and configured
- [Bun](https://bun.sh) >= 1.0

## Installation

```bash
bun add open-mem
```

## Configure OpenCode

Add `open-mem` to the `plugin` array in your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["open-mem"]
}
```

> **Note**: If you already have plugins, just append `"open-mem"` to the existing array.

That's it. open-mem starts capturing from your next OpenCode session.

## Enable AI Compression (Optional)

For intelligent compression of observations, configure an AI provider. Without a provider, open-mem still works — it falls back to a basic metadata extractor that captures tool names, file paths, and output snippets.

### Google Gemini (Default — Free Tier)

```bash
# Get a free key at https://aistudio.google.com/apikey
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Anthropic

```bash
export OPEN_MEM_PROVIDER=anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export OPEN_MEM_MODEL=claude-sonnet-4-20250514
```

### AWS Bedrock

```bash
export OPEN_MEM_PROVIDER=bedrock
export OPEN_MEM_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0
# Uses AWS credentials from environment (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or AWS_PROFILE)
```

### OpenAI

Requires installing the OpenAI SDK adapter:

```bash
bun add @ai-sdk/openai
```

```bash
export OPEN_MEM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export OPEN_MEM_MODEL=gpt-4o
```

### OpenRouter (100+ Models)

```bash
export OPEN_MEM_PROVIDER=openrouter
export OPENROUTER_API_KEY=sk-or-...
export OPEN_MEM_MODEL=google/gemini-2.5-flash-lite
```

### Auto-Detection

open-mem detects your provider from environment variables:

| Environment Variable | Provider |
|---|---|
| `GOOGLE_GENERATIVE_AI_API_KEY` (or `GEMINI_API_KEY`) | Google Gemini |
| `ANTHROPIC_API_KEY` | Anthropic |
| AWS credentials (`AWS_ACCESS_KEY_ID` / `AWS_PROFILE`) | Bedrock |
| `OPENROUTER_API_KEY` | OpenRouter |

## First Session

Your first session with open-mem will behave normally — there's no memory to inject yet. As you work (reading files, running commands, editing code), open-mem captures each tool execution in the background.

When the session goes idle, captured tool outputs are compressed into structured observations.

## Second Session Onwards

From your second session, you'll see a memory block injected into the system prompt:

```
🔧 [refactor] Extract pricing logic (~120 tokens) — src/pricing.ts
💡 [discovery] FTS5 requires specific tokenizer config (~85 tokens)
🐛 [bugfix] Fix off-by-one in pagination (~95 tokens) — src/api/list.ts
```

The agent can then use `mem-find` and `mem-get` to fetch full details about any observation.

## Using the Tools

### Search Memory

Ask your agent to search memory naturally:

> "What do we know about the pricing module?"

The agent will use `mem-find` to find relevant observations.

### Save Important Context

Ask the agent to remember something:

> "Remember that we decided to use SQLite instead of PostgreSQL for the local cache."

The agent will use `mem-create` to create a manual observation.

### View Session History

> "Show me what we worked on in recent sessions."

The agent will use `mem-history` to display session history.

### Recall Full Details

> "Get the full details on observation #abc123."

The agent will use `mem-get` to fetch the complete observation.

## Verify It Works

1. **Check plugin is loaded** — look for `[open-mem]` messages in OpenCode logs
2. **Check observations exist** — use the `mem-history` tool after your first session
3. **Check context injection** — look for the memory block at the start of your second session

## External Platform Workers

If you want to ingest events from non-OpenCode platforms, enable adapter workers:

```bash
export OPEN_MEM_PLATFORM_CLAUDE_CODE=true
export OPEN_MEM_PLATFORM_CURSOR=true

# Start one worker per platform integration
bunx open-mem-claude-code --project /path/to/project
bunx open-mem-cursor --project /path/to/project
```

Workers consume newline-delimited JSON events on stdin and write into the same project memory database.

## Next Steps

- [Architecture](/architecture) — understand how open-mem works internally
- [Memory Tools](/tools) — reference for all memory tools
- [Configuration](/configuration) — all environment variables and options
- [Privacy & Security](/privacy) — how your data is protected
