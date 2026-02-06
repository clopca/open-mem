# 20. Build and npm Prep

## Meta
- **ID**: open-mem-20
- **Feature**: open-mem
- **Phase**: 6
- **Priority**: P1
- **Depends On**: [open-mem-18]
- **Effort**: M (2h)
- **Tags**: [implementation, build, npm, publishing]
- **Requires UX/DX Review**: false

## Objective
Configure the build pipeline for producing a distributable npm package, including bundling with proper entry points, TypeScript declarations, and npm publishing metadata.

## Context
open-mem needs to be published as a standalone npm package that OpenCode users can install. The build must produce ESM output compatible with Bun, include TypeScript declarations, and have proper package.json fields for npm publishing.

**User Requirements**: Standalone npm-publishable package.

## Deliverables
- Updated `package.json` with publishing fields
- Build configuration (tsup or bun build)
- `.npmignore` or `files` field for clean publishing

## Implementation Steps

### Step 1: Update package.json for publishing
```json
{
  "name": "open-mem",
  "version": "0.1.0",
  "description": "Persistent memory plugin for OpenCode — captures, compresses, and recalls context across coding sessions",
  "type": "module",
  "main": "dist/index.js",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": [
    "dist",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "build": "bun run build:bundle && bun run build:types",
    "build:bundle": "bun build src/index.ts --outdir dist --target bun --format esm --minify",
    "build:types": "bun x tsc --declaration --emitDeclarationOnly --outDir dist",
    "dev": "bun run --watch src/index.ts",
    "test": "bun test",
    "typecheck": "bun x tsc --noEmit",
    "lint": "bun x biome check src/",
    "prepublishOnly": "bun run build && bun test",
    "clean": "rm -rf dist"
  },
  "keywords": [
    "opencode",
    "plugin",
    "memory",
    "ai",
    "sqlite",
    "fts5",
    "context",
    "persistent-memory",
    "coding-assistant"
  ],
  "license": "AGPL-3.0",
  "repository": {
    "type": "git",
    "url": "https://github.com/clopca/open-mem"
  },
  "bugs": {
    "url": "https://github.com/clopca/open-mem/issues"
  },
  "homepage": "https://github.com/clopca/open-mem#readme",
  "engines": {
    "bun": ">=1.0.0"
  },
  "peerDependencies": {
    "zod": "^3.0.0"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.7.0",
    "@biomejs/biome": "^1.9.0",
    "zod": "^3.24.0"
  }
}
```

### Step 2: Configure TypeScript for declaration output
Ensure `tsconfig.json` has:
```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist"
  }
}
```

### Step 3: Create .npmignore (or rely on `files` field)
The `files` field in package.json already limits what's published. Optionally create `.npmignore`:
```
src/
tests/
tasks/
.open-mem/
*.db
*.sqlite
tsconfig.json
biome.json
.gitignore
```

### Step 4: Verify build output
```bash
bun run clean
bun run build
ls -la dist/
# Should contain: index.js, index.d.ts
```

### Step 5: Test npm pack
```bash
npm pack --dry-run
# Verify only dist/, README.md, LICENSE, package.json are included
```

### Step 6: Add biome.json for linting
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `package.json` | Modify | Add exports, files, publishing metadata, updated scripts |
| `tsconfig.json` | Modify | Ensure declaration output configured |
| `.npmignore` | Create | Exclude source, tests, tasks from npm package |
| `biome.json` | Create | Linter/formatter configuration |

## Acceptance Criteria
- [ ] `package.json` has correct `exports`, `main`, `module`, `types` fields
- [ ] `package.json` `files` field limits published content to dist/, README.md, LICENSE
- [ ] `bun run build` produces `dist/index.js` and `dist/index.d.ts`
- [ ] `bun run build` completes without errors
- [ ] `npm pack --dry-run` shows only expected files
- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes (or has only warnings)
- [ ] `prepublishOnly` script runs build and tests
- [ ] `zod` is a peerDependency (not bundled)
- [ ] `biome.json` exists with reasonable defaults
- [ ] All validation commands pass

## Validation Commands

```bash
# Clean and build
cd /Users/clopca/dev/github/open-mem && bun run clean && bun run build

# Verify output
ls -la /Users/clopca/dev/github/open-mem/dist/

# Type check
cd /Users/clopca/dev/github/open-mem && bun run typecheck

# Lint
cd /Users/clopca/dev/github/open-mem && bun run lint

# Dry-run npm pack
cd /Users/clopca/dev/github/open-mem && npm pack --dry-run

# Verify package size
cd /Users/clopca/dev/github/open-mem && npm pack --dry-run 2>&1 | tail -1
```

## Notes
- `zod` is a peerDependency because OpenCode already provides it — no need to bundle
- `@anthropic-ai/sdk` is a regular dependency because it's not provided by OpenCode
- `bun:sqlite` is a Bun built-in — no dependency needed
- The build uses `--target bun` to ensure Bun-specific APIs (like `bun:sqlite`) are preserved
- Consider adding a `postinstall` script that warns if not running in Bun
- The `--minify` flag reduces bundle size for npm distribution
