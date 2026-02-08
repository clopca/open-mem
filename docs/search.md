# Search

open-mem provides powerful search capabilities for finding relevant observations across your project's memory.

## How Search Works

When you call `memory.find`, open-mem uses a multi-stage pipeline to find the most relevant observations:

1. **Query parsing** — extracts keywords and intent from your search query
2. **FTS5 full-text search** — fast keyword matching against titles, narratives, concepts, and facts
3. **Vector similarity search** (when available) — semantic matching using embeddings
4. **Reciprocal Rank Fusion** — merges results from both search methods
5. **Filtering** — applies type filters and returns top results

## Hybrid Search (FTS5 + Vector)

### FTS5 Full-Text Search

SQLite's FTS5 extension provides fast keyword-based search. It indexes:

- Observation titles
- Narratives and facts
- Concepts/tags
- File paths

FTS5 excels at exact keyword matches and phrase queries.

### Vector Embeddings

When an AI provider with embedding support is configured, open-mem generates vector embeddings for each observation. These enable semantic search — finding conceptually related results even when exact keywords don't match.

**Providers with embedding support:**

| Provider | Embedding Model | Status |
|---|---|---|
| Google Gemini | `text-embedding-004` | Supported |
| OpenAI | `text-embedding-3-small` | Supported |
| AWS Bedrock | `amazon.titan-embed-text-v2:0` | Supported |
| Anthropic | — | No embedding model (FTS5-only) |
| OpenRouter | — | No embedding model (FTS5-only) |

If no embedding model is available, search falls back to FTS5-only with no degradation in functionality.

### Reciprocal Rank Fusion (RRF)

When both FTS5 and vector search return results, open-mem merges them using Reciprocal Rank Fusion. RRF combines ranked lists by assigning each result a score based on its position in each list:

```
RRF_score = Σ (1 / (k + rank_i))
```

This produces a single ranked list that balances keyword relevance with semantic similarity.

## Search Strategies

### Keyword Search

Best for finding specific terms, function names, or file paths:

```
memory.find({ query: "calculateDiscount" })
memory.find({ query: "src/pricing.ts" })
```

### Concept Search

Best for finding observations about a topic:

```
memory.find({ query: "authentication flow" })
memory.find({ query: "database migration strategy" })
```

### Type-Filtered Search

Narrow results to specific observation types:

```
memory.find({ query: "pricing", type: "decision" })
memory.find({ query: "login", type: "bugfix" })
```

Available types: `decision`, `bugfix`, `feature`, `refactor`, `discovery`, `change`.

## How Embeddings Are Generated

Embeddings are generated automatically during observation processing:

1. When a pending observation is compressed by AI, the processor also generates an embedding vector
2. The vector is stored alongside the observation in the SQLite database (via `sqlite-vec`)
3. At search time, the query is embedded and compared against stored vectors using cosine similarity

No manual configuration is needed — if your provider supports embeddings, they're generated automatically.

## Search Tips

- **Be specific** — "pricing calculation bug in cart" works better than "bug"
- **Use file paths** — searching for a file path finds all observations related to that file
- **Filter by type** — if you know you're looking for a decision, filter to reduce noise
- **Start broad, then narrow** — use `memory.find` with a broad query, then `memory.get` for details
- **Combine with history** — use `memory.history` with an anchor to see temporal context around a result
