# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-06

### Added
- `mem-recall` tool for fetching full observation details by ID
- Progressive disclosure context injection with type icons, token costs, and file grouping
- `<private>` tag support for user-controlled content exclusion from memory
- Structured session summaries with request, investigated, learned, completed, and next steps fields
- Concept vocabulary guidance in AI compression prompts (how-it-works, gotcha, pattern, trade-off, etc.)
- Context injection configuration options (token cost display, observation type filters, full observation count)

### Fixed
- README `OPEN_MEM_CONTEXT_INJECTION` default incorrectly documented as `false` (actual default: `true`)
- Missing `.open-mem/` in project .gitignore

## [0.1.0] - 2026-01-15

### Added
- Initial release
- Automatic observation capture from tool executions
- AI-powered compression using Claude (optional — works without API key)
- SQLite + FTS5 full-text search for fast retrieval
- Context injection into new sessions via system prompt
- Three custom tools: `mem-search`, `mem-save`, `mem-timeline`
- Session summaries with AI-generated narratives
- Progressive disclosure with token budget management
- Configurable sensitive content redaction
- Data retention policies (default: 90 days)
- 162 tests with 395 assertions
