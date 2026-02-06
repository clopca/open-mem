# 05. Database Setup

## Meta
- **ID**: open-mem-05
- **Feature**: open-mem
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [open-mem-01, open-mem-03]
- **Effort**: M (2-3h)
- **Tags**: [implementation, database, sqlite]
- **Requires UX/DX Review**: false

## Objective
Implement SQLite database connection management using `bun:sqlite`, including initialization, migration system, WAL mode configuration, and graceful shutdown.

## Context
open-mem stores all data in a local SQLite database. This task creates the database lifecycle management layer — opening connections, running migrations, configuring performance settings (WAL mode, journal), and closing cleanly. The actual table schemas are defined in task 06.

**User Requirements**: SQLite + FTS5 storage. Reuse claude-mem architectural patterns.

**Related**: Task 06 (schema) depends on this task for the Database class.

## Deliverables
- `src/db/database.ts` with Database class for connection management and migrations

## Implementation Steps

### Step 1: Create Database class
```typescript
import { Database as BunDatabase } from "bun:sqlite";
import type { OpenMemConfig } from "../types";

export class Database {
  private db: BunDatabase;
  private config: OpenMemConfig;
  
  constructor(config: OpenMemConfig) {
    this.config = config;
    this.db = this.open(config.dbPath);
    this.configure();
  }
  
  private open(dbPath: string): BunDatabase {
    // Ensure directory exists
    const dir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    Bun.spawnSync(["mkdir", "-p", dir]);
    
    return new BunDatabase(dbPath, { create: true });
  }
  
  private configure(): void {
    // WAL mode for better concurrent read/write performance
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
  }
}
```

### Step 2: Implement migration system
```typescript
interface Migration {
  version: number;
  name: string;
  up: string;  // SQL to apply
}

// Migration tracking table
private ensureMigrationTable(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

public migrate(migrations: Migration[]): void {
  this.ensureMigrationTable();
  
  const applied = this.db
    .query("SELECT version FROM _migrations ORDER BY version")
    .all() as { version: number }[];
  const appliedVersions = new Set(applied.map(m => m.version));
  
  const pending = migrations
    .filter(m => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version);
  
  for (const migration of pending) {
    this.db.transaction(() => {
      this.db.exec(migration.up);
      this.db.run(
        "INSERT INTO _migrations (version, name) VALUES (?, ?)",
        [migration.version, migration.name]
      );
    })();
    console.log(`[open-mem] Applied migration ${migration.version}: ${migration.name}`);
  }
}
```

### Step 3: Implement query helpers
```typescript
// Expose query methods that wrap bun:sqlite
public run(sql: string, params?: unknown[]): void {
  if (params) {
    this.db.run(sql, params);
  } else {
    this.db.run(sql);
  }
}

public get<T>(sql: string, params?: unknown[]): T | null {
  const stmt = this.db.query(sql);
  return (params ? stmt.get(...params) : stmt.get()) as T | null;
}

public all<T>(sql: string, params?: unknown[]): T[] {
  const stmt = this.db.query(sql);
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

public exec(sql: string): void {
  this.db.exec(sql);
}

// Transaction helper
public transaction<T>(fn: () => T): T {
  return this.db.transaction(fn)();
}
```

### Step 4: Implement lifecycle methods
```typescript
public close(): void {
  this.db.close();
  console.log("[open-mem] Database closed");
}

public get isOpen(): boolean {
  // bun:sqlite doesn't have a direct isOpen check
  // Use a try/catch on a simple query
  try {
    this.db.query("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

// Get the raw bun:sqlite instance (for advanced use)
public get raw(): BunDatabase {
  return this.db;
}
```

### Step 5: Export factory function
```typescript
export function createDatabase(config: OpenMemConfig): Database {
  return new Database(config);
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/database.ts` | Create | Database class with connection management, migrations, query helpers |

## Acceptance Criteria
- [ ] `src/db/database.ts` exists and exports `Database` class and `createDatabase` function
- [ ] Database constructor creates SQLite file at configured path
- [ ] Database directory is created if it doesn't exist
- [ ] WAL mode is enabled on connection
- [ ] Foreign keys are enabled
- [ ] Migration system creates `_migrations` tracking table
- [ ] Migrations run in order and skip already-applied ones
- [ ] Query helpers (`run`, `get`, `all`, `exec`) work correctly
- [ ] `transaction` helper wraps operations in a SQLite transaction
- [ ] `close()` cleanly shuts down the database
- [ ] `bun x tsc --noEmit` passes
- [ ] All validation commands pass

## Validation Commands

```bash
# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Quick smoke test
cd /Users/clopca/dev/github/open-mem && bun -e "
  const { createDatabase } = require('./src/db/database.ts');
  const db = createDatabase({ dbPath: '/tmp/open-mem-test.db' });
  db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)');
  db.run('INSERT INTO test (id) VALUES (?)', [1]);
  const row = db.get('SELECT * FROM test WHERE id = ?', [1]);
  console.log('Row:', row);
  db.close();
  console.log('Database smoke test passed');
"
```

## Notes
- `bun:sqlite` is synchronous — all operations block. This is fine for a plugin but be aware for batch processing.
- WAL mode allows concurrent reads while writing, which is important since hooks may fire while the queue processor is writing.
- The migration system is intentionally simple — no "down" migrations. For a plugin, forward-only migrations are sufficient.
- Consider adding a `PRAGMA cache_size` setting for performance tuning.
- The `busy_timeout` of 5000ms prevents "database is locked" errors during concurrent access.
