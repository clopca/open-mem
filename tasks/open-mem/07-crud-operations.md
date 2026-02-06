# 07. CRUD Operations

## Meta
- **ID**: open-mem-07
- **Feature**: open-mem
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [open-mem-05, open-mem-06]
- **Effort**: L (3-4h)
- **Tags**: [implementation, database, crud, fts5]
- **Requires UX/DX Review**: false

## Objective
Implement all CRUD (Create, Read, Update, Delete) operations for sessions, observations, summaries, and pending messages, including FTS5 full-text search queries.

## Context
This task builds the data access layer on top of the Database class (task 05) and schema (task 06). Each entity gets its own module with typed CRUD functions. The FTS5 search queries are the key differentiator — they enable the search tools and context injection to find relevant past observations.

**User Requirements**: SQLite + FTS5 storage. Search via custom tools or MCP.

## Deliverables
- `src/db/sessions.ts` — Session CRUD operations
- `src/db/observations.ts` — Observation CRUD + FTS5 search queries
- `src/db/summaries.ts` — Summary CRUD operations

## Implementation Steps

### Step 1: Implement session operations (`src/db/sessions.ts`)
```typescript
import type { Database } from "./database";
import type { Session } from "../types";
import { randomUUID } from "crypto";

export class SessionRepository {
  constructor(private db: Database) {}
  
  create(sessionId: string, projectPath: string): Session {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO sessions (id, project_path, started_at, status) VALUES (?, ?, ?, 'active')`,
      [sessionId, projectPath, now]
    );
    return this.getById(sessionId)!;
  }
  
  getById(id: string): Session | null {
    const row = this.db.get<any>(
      "SELECT * FROM sessions WHERE id = ?", [id]
    );
    return row ? this.mapRow(row) : null;
  }
  
  getOrCreate(sessionId: string, projectPath: string): Session {
    const existing = this.getById(sessionId);
    if (existing) return existing;
    return this.create(sessionId, projectPath);
  }
  
  updateStatus(id: string, status: Session["status"]): void {
    this.db.run(
      "UPDATE sessions SET status = ? WHERE id = ?",
      [status, id]
    );
  }
  
  markCompleted(id: string): void {
    this.db.run(
      "UPDATE sessions SET status = 'completed', ended_at = datetime('now') WHERE id = ?",
      [id]
    );
  }
  
  incrementObservationCount(id: string): void {
    this.db.run(
      "UPDATE sessions SET observation_count = observation_count + 1 WHERE id = ?",
      [id]
    );
  }
  
  setSummary(sessionId: string, summaryId: string): void {
    this.db.run(
      "UPDATE sessions SET summary_id = ? WHERE id = ?",
      [summaryId, sessionId]
    );
  }
  
  getRecent(projectPath: string, limit: number = 10): Session[] {
    return this.db.all<any>(
      "SELECT * FROM sessions WHERE project_path = ? ORDER BY started_at DESC LIMIT ?",
      [projectPath, limit]
    ).map(this.mapRow);
  }
  
  getActive(): Session[] {
    return this.db.all<any>(
      "SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC"
    ).map(this.mapRow);
  }
  
  private mapRow(row: any): Session {
    return {
      id: row.id,
      projectPath: row.project_path,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: row.status,
      observationCount: row.observation_count,
      summaryId: row.summary_id,
    };
  }
}
```

### Step 2: Implement observation operations (`src/db/observations.ts`)
```typescript
import type { Database } from "./database";
import type { Observation, ObservationIndex, SearchQuery, SearchResult } from "../types";
import { randomUUID } from "crypto";

export class ObservationRepository {
  constructor(private db: Database) {}
  
  create(observation: Omit<Observation, "id" | "createdAt">): Observation {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO observations (id, session_id, type, title, subtitle, facts, narrative, concepts, files_read, files_modified, raw_tool_output, tool_name, created_at, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, observation.sessionId, observation.type, observation.title,
        observation.subtitle, JSON.stringify(observation.facts),
        observation.narrative, JSON.stringify(observation.concepts),
        JSON.stringify(observation.filesRead), JSON.stringify(observation.filesModified),
        observation.rawToolOutput, observation.toolName, now, observation.tokenCount,
      ]
    );
    return { ...observation, id, createdAt: now };
  }
  
  getById(id: string): Observation | null {
    const row = this.db.get<any>(
      "SELECT * FROM observations WHERE id = ?", [id]
    );
    return row ? this.mapRow(row) : null;
  }
  
  getBySession(sessionId: string): Observation[] {
    return this.db.all<any>(
      "SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC",
      [sessionId]
    ).map(this.mapRow);
  }
  
  // FTS5 full-text search
  search(query: SearchQuery): SearchResult[] {
    let sql = `
      SELECT o.*, rank
      FROM observations o
      JOIN observations_fts fts ON o.rowid = fts.rowid
      WHERE observations_fts MATCH ?
    `;
    const params: unknown[] = [query.query];
    
    if (query.sessionId) {
      sql += " AND o.session_id = ?";
      params.push(query.sessionId);
    }
    if (query.type) {
      sql += " AND o.type = ?";
      params.push(query.type);
    }
    
    sql += " ORDER BY rank LIMIT ? OFFSET ?";
    params.push(query.limit ?? 10);
    params.push(query.offset ?? 0);
    
    return this.db.all<any>(sql, params).map(row => ({
      observation: this.mapRow(row),
      rank: row.rank,
      snippet: row.title,  // FTS5 snippet can be added later
    }));
  }
  
  // Get lightweight index for progressive disclosure
  getIndex(projectPath: string, limit: number = 20): ObservationIndex[] {
    return this.db.all<any>(
      `SELECT o.id, o.session_id, o.type, o.title, o.token_count, o.created_at
       FROM observations o
       JOIN sessions s ON o.session_id = s.id
       WHERE s.project_path = ?
       ORDER BY o.created_at DESC
       LIMIT ?`,
      [projectPath, limit]
    ).map(row => ({
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      title: row.title,
      tokenCount: row.token_count,
      createdAt: row.created_at,
    }));
  }
  
  // Get observations by concept (FTS5)
  searchByConcept(concept: string, limit: number = 10): Observation[] {
    return this.db.all<any>(
      `SELECT o.*
       FROM observations o
       JOIN observations_fts fts ON o.rowid = fts.rowid
       WHERE observations_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [`concepts:${concept}`, limit]
    ).map(this.mapRow);
  }
  
  // Get observations by file path
  searchByFile(filePath: string, limit: number = 10): Observation[] {
    return this.db.all<any>(
      `SELECT o.*
       FROM observations o
       JOIN observations_fts fts ON o.rowid = fts.rowid
       WHERE observations_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [`files_read:${filePath} OR files_modified:${filePath}`, limit]
    ).map(this.mapRow);
  }
  
  getCount(sessionId?: string): number {
    if (sessionId) {
      return (this.db.get<any>(
        "SELECT COUNT(*) as count FROM observations WHERE session_id = ?",
        [sessionId]
      ))?.count ?? 0;
    }
    return (this.db.get<any>("SELECT COUNT(*) as count FROM observations"))?.count ?? 0;
  }
  
  private mapRow(row: any): Observation {
    return {
      id: row.id,
      sessionId: row.session_id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      facts: JSON.parse(row.facts),
      narrative: row.narrative,
      concepts: JSON.parse(row.concepts),
      filesRead: JSON.parse(row.files_read),
      filesModified: JSON.parse(row.files_modified),
      rawToolOutput: row.raw_tool_output,
      toolName: row.tool_name,
      createdAt: row.created_at,
      tokenCount: row.token_count,
    };
  }
}
```

### Step 3: Implement summary operations (`src/db/summaries.ts`)
```typescript
import type { Database } from "./database";
import type { SessionSummary } from "../types";
import { randomUUID } from "crypto";

export class SummaryRepository {
  constructor(private db: Database) {}
  
  create(summary: Omit<SessionSummary, "id" | "createdAt">): SessionSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO session_summaries (id, session_id, summary, key_decisions, files_modified, concepts, created_at, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, summary.sessionId, summary.summary,
        JSON.stringify(summary.keyDecisions), JSON.stringify(summary.filesModified),
        JSON.stringify(summary.concepts), now, summary.tokenCount,
      ]
    );
    return { ...summary, id, createdAt: now };
  }
  
  getBySessionId(sessionId: string): SessionSummary | null {
    const row = this.db.get<any>(
      "SELECT * FROM session_summaries WHERE session_id = ?",
      [sessionId]
    );
    return row ? this.mapRow(row) : null;
  }
  
  getRecent(limit: number = 10): SessionSummary[] {
    return this.db.all<any>(
      "SELECT * FROM session_summaries ORDER BY created_at DESC LIMIT ?",
      [limit]
    ).map(this.mapRow);
  }
  
  // FTS5 search across summaries
  search(query: string, limit: number = 10): SessionSummary[] {
    return this.db.all<any>(
      `SELECT ss.*
       FROM session_summaries ss
       JOIN summaries_fts fts ON ss.rowid = fts.rowid
       WHERE summaries_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
      [query, limit]
    ).map(this.mapRow);
  }
  
  private mapRow(row: any): SessionSummary {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      keyDecisions: JSON.parse(row.key_decisions),
      filesModified: JSON.parse(row.files_modified),
      concepts: JSON.parse(row.concepts),
      createdAt: row.created_at,
      tokenCount: row.token_count,
    };
  }
}
```

### Step 4: Implement pending message operations (add to observations.ts or separate file)
```typescript
// Can be in src/db/observations.ts or src/db/pending.ts

export class PendingMessageRepository {
  constructor(private db: Database) {}
  
  create(msg: Omit<PendingMessage, "id" | "createdAt" | "status" | "retryCount" | "error">): PendingMessage {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO pending_messages (id, session_id, tool_name, tool_output, call_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, msg.sessionId, msg.toolName, msg.toolOutput, msg.callId, now]
    );
    return { ...msg, id, createdAt: now, status: "pending", retryCount: 0, error: null };
  }
  
  getPending(limit: number = 10): PendingMessage[] {
    return this.db.all<any>(
      "SELECT * FROM pending_messages WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
      [limit]
    ).map(this.mapRow);
  }
  
  markProcessing(id: string): void {
    this.db.run("UPDATE pending_messages SET status = 'processing' WHERE id = ?", [id]);
  }
  
  markCompleted(id: string): void {
    this.db.run("UPDATE pending_messages SET status = 'completed' WHERE id = ?", [id]);
  }
  
  markFailed(id: string, error: string): void {
    this.db.run(
      "UPDATE pending_messages SET status = 'failed', error = ?, retry_count = retry_count + 1 WHERE id = ?",
      [error, id]
    );
  }
  
  resetStale(olderThanMinutes: number = 5): number {
    const result = this.db.all<any>(
      `UPDATE pending_messages SET status = 'pending'
       WHERE status = 'processing'
       AND created_at < datetime('now', ? || ' minutes')
       RETURNING id`,
      [`-${olderThanMinutes}`]
    );
    return result.length;
  }
  
  private mapRow(row: any): PendingMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      toolName: row.tool_name,
      toolOutput: row.tool_output,
      callId: row.call_id,
      createdAt: row.created_at,
      status: row.status,
      retryCount: row.retry_count,
      error: row.error,
    };
  }
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/sessions.ts` | Create | SessionRepository class with CRUD operations |
| `src/db/observations.ts` | Create | ObservationRepository class with CRUD + FTS5 search |
| `src/db/summaries.ts` | Create | SummaryRepository class with CRUD + FTS5 search |

## Acceptance Criteria
- [ ] `src/db/sessions.ts` exports `SessionRepository` with create, getById, getOrCreate, updateStatus, markCompleted, getRecent, getActive
- [ ] `src/db/observations.ts` exports `ObservationRepository` with create, getById, getBySession, search (FTS5), getIndex, searchByConcept, searchByFile, getCount
- [ ] `src/db/summaries.ts` exports `SummaryRepository` with create, getBySessionId, getRecent, search (FTS5)
- [ ] PendingMessageRepository exists with create, getPending, markProcessing, markCompleted, markFailed, resetStale
- [ ] JSON arrays (facts, concepts, etc.) are serialized on write and parsed on read
- [ ] FTS5 search returns ranked results
- [ ] ObservationIndex returns lightweight projection (id, sessionId, type, title, tokenCount, createdAt)
- [ ] All repositories use the Database class for queries
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Integration smoke test
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { createDatabase } = require('./src/db/database.ts');
  const { initializeSchema } = require('./src/db/schema.ts');
  const { SessionRepository } = require('./src/db/sessions.ts');
  const { ObservationRepository } = require('./src/db/observations.ts');
  
  const db = createDatabase({ dbPath: '/tmp/open-mem-crud-test.db' });
  initializeSchema(db);
  
  const sessions = new SessionRepository(db);
  const observations = new ObservationRepository(db);
  
  const session = sessions.create('test-session-1', '/tmp/project');
  console.log('Session:', session);
  
  const obs = observations.create({
    sessionId: session.id,
    type: 'discovery',
    title: 'Found important pattern',
    subtitle: 'In the auth module',
    facts: ['Uses JWT tokens', 'Expires in 1 hour'],
    narrative: 'Discovered that the auth module uses JWT tokens with 1 hour expiry.',
    concepts: ['authentication', 'JWT'],
    filesRead: ['src/auth.ts'],
    filesModified: [],
    rawToolOutput: 'cat src/auth.ts output...',
    toolName: 'Read',
    tokenCount: 150,
  });
  console.log('Observation:', obs);
  
  const results = observations.search({ query: 'JWT authentication' });
  console.log('Search results:', results.length);
  
  db.close();
  console.log('CRUD smoke test passed');
"
```

## Notes
- JSON serialization for arrays is a pragmatic choice — it avoids junction tables while keeping queries simple
- FTS5 MATCH syntax supports: simple terms, phrases ("exact phrase"), column filters (title:word), boolean operators (AND, OR, NOT)
- The `rank` column from FTS5 is a negative number — more negative = better match. Consider normalizing for display.
- `resetStale` handles the case where the plugin crashes mid-processing — stale "processing" messages get reset to "pending"
- Consider adding a `deleteOlderThan` method for data retention/cleanup
