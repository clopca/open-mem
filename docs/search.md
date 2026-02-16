# Search

open-mem's search goes beyond simple keyword matching. When you call `mem-find`, it can combine full-text search, vector similarity, knowledge graph traversal, and LLM reranking to surface the most relevant observations — even when you don't remember the exact words used.

## How Search Works

`mem-find` runs a multi-stage pipeline:

1. **Query parsing** — extracts keywords and intent from your search query
2. **FTS5 full-text search** — fast keyword matching against titles, narratives, concepts, and facts
3. **Vector similarity search** (when available) — semantic matching using embeddings
4. **Reciprocal Rank Fusion** — merges results from both search methods
5. **Graph augmentation** (when entity extraction is enabled) — adds related observations from the knowledge graph
6. **LLM reranking** (when enabled) — re-scores candidates using the AI provider
7. **Filtering** — applies type filters and returns top results

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

## Knowledge Graph Search

When entity extraction is enabled (`OPEN_MEM_ENTITY_EXTRACTION=true`), open-mem builds a knowledge graph alongside the observation store. During compression, it extracts entities (technologies, libraries, patterns, concepts, files) and their relationships (uses, depends_on, implements, extends, etc.) from each observation.

At search time, graph-augmented search works like this:

1. Extract entity candidates from the query
2. Look up matching entities in the graph
3. Traverse their relationships (one hop) to find related entities
4. Collect observations linked to those related entities
5. Append them to the base FTS5/vector results (deduplicated)

This surfaces connections that keyword and embedding search would miss. For example, searching for "authentication" might also return observations about "JWT" or "session tokens" if the graph knows they're related.

Entity types and relationship types are defined by the active [workflow mode](/configuration#workflow-modes).

## LLM Reranking

For high-stakes searches, you can enable LLM-based reranking (`OPEN_MEM_RERANKING=true`). After the initial search pipeline produces candidates, the reranker sends them to your AI provider to judge relevance against the original query.

This is more expensive (one LLM call per search) but produces noticeably better results when the candidate pool is large or the query is ambiguous. Configure with:

```bash
export OPEN_MEM_RERANKING=true
export OPEN_MEM_RERANKING_MAX_CANDIDATES=20  # default
```

The reranker respects the rate limiter and fallback chain like all other AI operations.

## Search Strategies

### Keyword Search

Best for finding specific terms, function names, or file paths:

```ts
mem-find({ query: "calculateDiscount" })
mem-find({ query: "src/pricing.ts" })
```

### Concept Search

Best for finding observations about a topic:

```ts
mem-find({ query: "authentication flow" })
mem-find({ query: "database migration strategy" })
```

### Type-Filtered Search

Narrow results to specific observation types:

```ts
mem-find({ query: "pricing", type: "decision" })
mem-find({ query: "login", type: "bugfix" })
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
- **Start broad, then narrow** — use `mem-find` with a broad query, then `mem-get` for details
- **Combine with history** — use `mem-history` with an anchor to see temporal context around a result
