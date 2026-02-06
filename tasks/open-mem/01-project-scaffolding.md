# 01. Project Scaffolding

## Meta
- **ID**: open-mem-01
- **Feature**: open-mem
- **Phase**: 1
- **Priority**: P1
- **Depends On**: []
- **Effort**: M (2-3h)
- **Tags**: [implementation, scaffolding, setup]
- **Requires UX/DX Review**: false

## Objective
Initialize the open-mem project as a standalone npm-publishable TypeScript package with Bun as the runtime, including all build tooling and project configuration.

## Context
The repo at `/Users/clopca/dev/github/open-mem` is freshly created with only a LICENSE file (AGPL-3.0). This task sets up the entire project structure so subsequent tasks can immediately start writing source code.

**User Requirements**: Standalone npm-publishable package, project name `open-mem`.

## Deliverables
- `package.json` with correct metadata, dependencies, and scripts
- `tsconfig.json` configured for Bun + library output
- `.gitignore` for Node/Bun/TypeScript projects
- `src/index.ts` stub entry point
- Directory structure for all source modules

## Implementation Steps

### Step 1: Create package.json
```json
{
  "name": "open-mem",
  "version": "0.1.0",
  "description": "Persistent memory plugin for OpenCode — captures, compresses, and recalls context across coding sessions",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "bun run build:bundle && bun run build:types",
    "build:bundle": "bun build src/index.ts --outdir dist --target bun --format esm --external bun:sqlite",
    "build:types": "bun x tsc --declaration --emitDeclarationOnly --outDir dist",
    "dev": "bun run --watch src/index.ts",
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit",
    "lint": "bun x biome check src/",
    "prepublishOnly": "bun run build"
  },
  "keywords": ["opencode", "plugin", "memory", "ai", "sqlite"],
  "license": "AGPL-3.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/clopca/open-mem"
  },
  "engines": {
    "bun": ">=1.0.0"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0",
    "@biomejs/biome": "^1.9.0"
  }
}
```

### Step 2: Create tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ESNext"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 3: Create .gitignore
Include standard Node/Bun ignores: `node_modules/`, `dist/`, `*.db`, `*.sqlite`, `.env`, `.DS_Store`, `bun.lockb` (or keep it — team preference).

### Step 4: Create directory structure
```
src/
├── index.ts          # Stub plugin entry point
├── types.ts          # (placeholder, created in task 02)
├── config.ts         # (placeholder, created in task 03)
├── db/
├── ai/
├── queue/
├── context/
├── hooks/
└── tools/
tests/
├── db/
├── ai/
├── hooks/
└── context/
```

### Step 5: Create stub src/index.ts
```typescript
// open-mem: Persistent memory plugin for OpenCode
// This is the plugin entry point — will be fully wired in task 18

export default async function plugin(input: { project: unknown; directory: string; worktree: string }) {
  console.log("[open-mem] Plugin loaded for project at:", input.directory);
  return {};
}
```

### Step 6: Install dependencies
```bash
cd /Users/clopca/dev/github/open-mem
bun install
```

### Step 7: Verify build
```bash
bun run typecheck
bun run build
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `package.json` | Create | npm package configuration |
| `tsconfig.json` | Create | TypeScript configuration |
| `.gitignore` | Create | git ignore rules |
| `src/index.ts` | Create | Stub plugin entry point |
| `src/db/.gitkeep` | Create | Directory placeholder |
| `src/ai/.gitkeep` | Create | Directory placeholder |
| `src/queue/.gitkeep` | Create | Directory placeholder |
| `src/context/.gitkeep` | Create | Directory placeholder |
| `src/hooks/.gitkeep` | Create | Directory placeholder |
| `src/tools/.gitkeep` | Create | Directory placeholder |
| `tests/` | Create | Test directory structure |

## Acceptance Criteria
- [ ] `package.json` exists with name `open-mem`, correct dependencies, and scripts
- [ ] `tsconfig.json` exists and targets ESNext with Bun types
- [ ] `.gitignore` excludes node_modules, dist, *.db, .env
- [ ] `src/index.ts` exists and exports a default plugin function
- [ ] `bun install` completes without errors
- [ ] `bun run typecheck` passes (no type errors)
- [ ] `bun run build` produces output in `dist/`
- [ ] All source directories exist (`src/db/`, `src/ai/`, etc.)
- [ ] All validation commands pass

## Validation Commands

```bash
# Install dependencies
cd /Users/clopca/dev/github/open-mem && bun install

# Type check
cd /Users/clopca/dev/github/open-mem && bun x tsc --noEmit

# Build
cd /Users/clopca/dev/github/open-mem && bun run build

# Verify output exists
ls /Users/clopca/dev/github/open-mem/dist/index.js

# Verify package.json is valid
cd /Users/clopca/dev/github/open-mem && node -e "const p = require('./package.json'); console.log(p.name, p.version)"
```

## Notes
- The `@anthropic-ai/sdk` version should match what's current at implementation time
- `zod` is needed for custom tool argument validation (OpenCode plugin API uses it)
- Bun's built-in SQLite (`bun:sqlite`) doesn't need a separate dependency
- The stub `src/index.ts` uses an inline type for the plugin input — task 02 creates the full `Plugin` type, and task 18 will wire everything together.
- Consider adding a `biome.json` for linter configuration
