# Contributing to open-mem

Thank you for your interest in contributing to open-mem! This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh) >= 1.0

## Setup

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/open-mem.git
cd open-mem

# Install dependencies
bun install
```

## Development Workflow

```bash
# Run in watch mode (auto-restarts on changes)
bun run dev

# Run the test suite
bun test

# Type check
bun run typecheck

# Lint and format
bun run lint

# Build for production
bun run build

# Clean build artifacts
bun run clean
```

## Code Style

open-mem uses [Biome](https://biomejs.dev/) for formatting and linting (not ESLint/Prettier).

```bash
# Check formatting and lint rules
bun x biome check src/

# Auto-fix issues
bun x biome check --write src/
```

## Project Structure

```
src/
├── index.ts              Plugin entry point
├── types.ts              TypeScript interfaces
├── config.ts             Configuration management
├── db/                   SQLite + FTS5 data layer
├── ai/                   AI compression & summarization
├── hooks/                OpenCode hook handlers
├── queue/                Batch queue processor
├── context/              Context retrieval & injection
└── tools/                Custom tool definitions
```

## Making Changes

1. **Fork** the repository and create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```

2. **Make your changes** — keep commits focused and atomic.

3. **Run the full check suite** before submitting:
   ```bash
   bun test && bun run typecheck && bun run lint
   ```

4. **Submit a pull request** against `main`.

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Purpose |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Maintenance, dependencies |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding or updating tests |

Examples:
```
feat: add mem-recall tool for observation retrieval
fix: correct context injection token counting
docs: update configuration table in README
chore: bump @anthropic-ai/sdk to 0.40.0
```

## Reporting Issues

- **Bugs**: Use the [Bug Report](https://github.com/clopca/open-mem/issues/new?template=bug_report.md) template.
- **Features**: Use the [Feature Request](https://github.com/clopca/open-mem/issues/new?template=feature_request.md) template.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE) license.
