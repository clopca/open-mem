# 06. Schema and FTS5

## Meta
- **ID**: open-mem-06
- **Feature**: open-mem
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [open-mem-05]
- **Effort**: M (2-3h)
- **Tags**: [implementation, database, schema, fts5]
- **Requires UX/DX Review**: false

## Objective
Define all SQLite table schemas, FTS5 virtual tables for full-text search, and indexes. Create the migration definitions that the Database class will execute.

## Context
The schema follows claude-mem's data model: sessions, observations, session_summaries, and pending_messages. FTS5 virtual tables enable fast full-text search across observation content. This task defines the SQL migrations; the Database class from task 05 runs them.

**User Requirements**: SQLite + FTS5 storage. Reuse claude-mem architectural patterns.

**Related Specs**: claude-mem schema tables: `sdk_sessions`, `observations`, `session_summaries`, `user_prompts`, `pending_messages`.

## Deliverables
- `src/db/schema.ts` with migration definitions and schema constants

## Implementation Steps

### Step 1: Define migration v1 — core tables
```typescript
import type { Migration } from "./database";

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "create-core-tables",
    up: `
      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'idle', 'completed')),
        observation_count INTEGER NOT NULL DEFAULT 0,
        summary_id TEXT,
        FOREIGN KEY (summary_id) REFERENCES session_summaries(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);
      
      -- Observations table
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change')),
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        facts TEXT NOT NULL DEFAULT '[]',
        narrative TEXT NOT NULL DEFAULT '',
        concepts TEXT NOT NULL DEFAULT '[]',
        files_read TEXT NOT NULL DEFAULT '[]',
        files_modified TEXT NOT NULL DEFAULT '[]',
        raw_tool_output TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        token_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at DESC);
      
      -- Session summaries table
      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL UNIQUE,
        summary TEXT NOT NULL,
        key_decisions TEXT NOT NULL DEFAULT '[]',
        files_modified TEXT NOT NULL DEFAULT '[]',
        concepts TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        token_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      -- Pending messages (queue persistence)
      CREATE TABLE IF NOT EXISTS pending_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        tool_output TEXT NOT NULL,
        call_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_messages(status);
      CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_messages(session_id);
    `,
  },
];
```

### Step 2: Define migration v2 — FTS5 virtual tables
```typescript
{
  version: 2,
  name: "create-fts5-tables",
  up: `
    -- FTS5 for observations (search across title, narrative, facts, concepts)
    CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
      title,
      subtitle,
      narrative,
      facts,
      concepts,
      files_read,
      files_modified,
      content=observations,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );
    
    -- Triggers to keep FTS5 in sync with observations table
    CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts, files_read, files_modified)
      VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts, new.files_read, new.files_modified);
    END;
    
    CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts, files_read, files_modified)
      VALUES ('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts, old.files_read, old.files_modified);
    END;
    
    CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts, files_read, files_modified)
      VALUES ('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts, old.files_read, old.files_modified);
      INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts, files_read, files_modified)
      VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts, new.files_read, new.files_modified);
    END;
    
    -- FTS5 for session summaries
    CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
      summary,
      key_decisions,
      concepts,
      content=session_summaries,
      content_rowid=rowid,
      tokenize='porter unicode61'
    );
    
    CREATE TRIGGER IF NOT EXISTS summaries_ai AFTER INSERT ON session_summaries BEGIN
      INSERT INTO summaries_fts(rowid, summary, key_decisions, concepts)
      VALUES (new.rowid, new.summary, new.key_decisions, new.concepts);
    END;
    
    CREATE TRIGGER IF NOT EXISTS summaries_ad AFTER DELETE ON session_summaries BEGIN
      INSERT INTO summaries_fts(summaries_fts, rowid, summary, key_decisions, concepts)
      VALUES ('delete', old.rowid, old.summary, old.key_decisions, old.concepts);
    END;
  `,
},
```

### Step 3: Export schema constants and helper
```typescript
// Table names as constants
export const TABLES = {
  SESSIONS: "sessions",
  OBSERVATIONS: "observations",
  SESSION_SUMMARIES: "session_summaries",
  PENDING_MESSAGES: "pending_messages",
  OBSERVATIONS_FTS: "observations_fts",
  SUMMARIES_FTS: "summaries_fts",
} as const;

// Initialize database with all migrations
export function initializeSchema(db: Database): void {
  db.migrate(MIGRATIONS);
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/schema.ts` | Create | Migration definitions, FTS5 setup, table constants |

## Acceptance Criteria
- [ ] `src/db/schema.ts` exists and exports `MIGRATIONS`, `TABLES`, and `initializeSchema`
- [ ] Migration v1 creates: sessions, observations, session_summaries, pending_messages tables
- [ ] Migration v2 creates: observations_fts, summaries_fts FTS5 virtual tables
- [ ] FTS5 tables use porter tokenizer with unicode61
- [ ] FTS5 sync triggers exist for INSERT, UPDATE, DELETE on observations
- [ ] FTS5 sync triggers exist for INSERT, DELETE on session_summaries
- [ ] All tables have appropriate indexes
- [ ] observations.type has CHECK constraint for valid types
- [ ] pending_messages.status has CHECK constraint for valid statuses
- [ ] sessions.status has CHECK constraint for valid statuses
- [ ] Foreign key relationships are defined
- [ ] `initializeSchema` runs all migrations via Database.migrate()
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Smoke test — create DB and verify tables
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { createDatabase } = require('./src/db/database.ts');
  const { initializeSchema, TABLES } = require('./src/db/schema.ts');
  const db = createDatabase({ dbPath: '/tmp/open-mem-schema-test.db' });
  initializeSchema(db);
  const tables = db.all('SELECT name FROM sqlite_master WHERE type=\"table\" ORDER BY name');
  console.log('Tables:', tables.map(t => t.name));
  db.close();
"
```

## Notes
- JSON arrays (facts, concepts, files_read, files_modified, key_decisions) are stored as TEXT with JSON serialization. Parse with `JSON.parse()` on read.
- FTS5 `content=observations` creates a "content table" FTS5 — it doesn't store its own copy of the data, just the index. This saves disk space.
- The `porter` tokenizer handles English stemming (e.g., "running" matches "run"). `unicode61` handles Unicode normalization.
- FTS5 triggers must handle the special `'delete'` command syntax for content tables.
- Consider adding a migration v3 later for any schema changes needed during development.
