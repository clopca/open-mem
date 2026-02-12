---
layout: home

hero:
  name: open-mem
  text: Persistent memory for AI coding assistants
  tagline: Captures, compresses, and recalls context across coding sessions — so your agent remembers what you've been working on.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/clopca/open-mem

features:
  - title: Automatic Capture
    details: Observes tool executions and user prompts in the background. No manual effort required.
  - title: AI Compression
    details: Distills raw tool outputs into structured observations using Gemini, Claude, GPT, or Bedrock.
  - title: Hybrid Search
    details: FTS5 full-text search combined with vector embeddings and Reciprocal Rank Fusion for high-relevance recall.
  - title: Progressive Disclosure
    details: Injects a compact memory index into the system prompt. The agent decides what to fetch — minimizing context window usage.
  - title: Privacy-First
    details: All data stored locally. Automatic redaction of API keys and secrets. Private tag support for full exclusion.
  - title: Zero Config
    details: Works out of the box as an OpenCode plugin. Optional AI compression for richer observations.
---

## Quick Install

```bash
bun add open-mem
```

Add to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["open-mem"]
}
```

That's it. open-mem starts capturing from your next session.

::: tip Optional: AI Compression
For intelligent compression, set a Google Gemini API key (free tier):

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=...
```

See [Getting Started](/getting-started) for all provider options.
:::
