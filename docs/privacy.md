# Privacy & Security

open-mem is designed with privacy as a core principle. All data stays local by default, and multiple layers of protection ensure sensitive information doesn't leak.

## Local Data Storage

All data is stored locally in your project's `.open-mem/` directory:

```
.open-mem/
├── memory.db        # SQLite database with observations, sessions, embeddings
└── config.json      # Optional project config
```

No data leaves your machine unless AI compression is enabled (it is on by default — disable with `OPEN_MEM_COMPRESSION=false`).

## AI Provider Data Flow

When AI compression is enabled, the following data is sent to your configured provider:

- **Tool outputs** — the raw output from tool executions (after redaction)
- **User prompts** — your messages to the AI assistant (after private tag stripping)

The AI provider returns compressed observations. The raw data is not stored by the provider beyond their standard API processing.

### Disable AI Compression

To keep everything fully local with no external API calls:

```bash
export OPEN_MEM_COMPRESSION=false
```

open-mem will still capture observations using a basic metadata extractor — it just won't have the rich semantic compression that AI provides.

## Automatic Redaction

Before any data is stored or sent to an AI provider, open-mem automatically redacts common sensitive patterns:

- **API keys and tokens** — `sk-ant-...`, `ghp_...`, `Bearer ...`, `token_...`
- **Passwords and secrets** — `password=...`, `secret=...`
- **Environment variable values** matching sensitive patterns
- **Custom patterns** via the `sensitivePatterns` config option

### Custom Redaction Patterns

Add your own regex patterns to catch domain-specific sensitive data:

```json
{
  "sensitivePatterns": [
    "INTERNAL_TOKEN_[A-Za-z0-9]+",
    "company-secret-\\w+"
  ]
}
```

## Private Tags

Wrap any content in `<private>...</private>` tags to exclude it from memory entirely. Private blocks are stripped **before** observation capture — they never reach the database or the AI provider.

```
<private>
API_KEY=sk-prod-super-secret-key
DB_PASSWORD=hunter2
Internal architecture notes that shouldn't be memorized
</private>
```

This is useful for:
- Sharing credentials temporarily during a session
- Excluding sensitive internal documentation
- Preventing specific tool outputs from being captured

## Gitignore

The `.open-mem/` directory contains your project's memory database. Add it to `.gitignore` to prevent committing memory data to version control:

```bash
echo '.open-mem/' >> .gitignore
```

::: warning
If you don't gitignore `.open-mem/`, your observation data (including potentially sensitive tool outputs) could end up in your repository.
:::

## Data Retention

By default, observations older than 90 days are automatically deleted. Adjust with:

```bash
# Keep for 30 days
export OPEN_MEM_RETENTION_DAYS=30

# Keep forever
export OPEN_MEM_RETENTION_DAYS=0
```

## Observation Lineage

When you use `mem-remove`, observations are **soft-deleted** (tombstoned), not hard-deleted. This preserves lineage for audit purposes while hiding them from search and recall.

To fully purge all data:

```bash
rm -rf .open-mem/
```

## Summary

| Layer | Protection |
|---|---|
| Capture | `<private>` tags stripped before processing |
| Storage | Automatic redaction of API keys, tokens, passwords |
| Transmission | Sent to configured AI provider when compression is enabled (default: on) |
| Retention | Configurable auto-deletion (default: 90 days) |
| Deletion | Soft-delete preserves lineage; `rm -rf` for full purge |
| Version control | `.open-mem/` should be in `.gitignore` |
