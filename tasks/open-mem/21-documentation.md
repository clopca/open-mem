# 21. Documentation

## Meta
- **ID**: open-mem-21
- **Feature**: open-mem
- **Phase**: 6
- **Priority**: P2
- **Depends On**: [open-mem-18, open-mem-20]
- **Effort**: M (2-3h)
- **Tags**: [implementation, documentation]
- **Requires UX/DX Review**: true

## Objective
Create comprehensive README documentation covering installation, configuration, usage, architecture, and contributing guidelines.

## Context
As a standalone npm-publishable package, open-mem needs clear documentation for users to install, configure, and use it with OpenCode. The README is the primary entry point for new users.

**User Requirements**: Standalone npm-publishable package (needs docs for users).

## Deliverables
- `README.md` — Full documentation

## Implementation Steps

### Step 1: Write README.md with the following sections

1. **Header**: Project name, tagline, badges (license, npm version)
2. **Overview**: What open-mem does, key features
3. **Quick Start**: Minimal setup instructions
4. **Installation**: npm install command
5. **Configuration**: All config options with defaults
6. **How It Works**: Architecture overview
   - Observation capture (tool.execute.after)
   - AI compression pipeline
   - Queue-based processing
   - Context injection (progressive disclosure)
   - Custom tools
7. **Custom Tools Reference**:
   - mem-search: usage, arguments, examples
   - mem-save: usage, arguments, examples
   - mem-timeline: usage, arguments, examples
8. **Configuration Reference**: Full table of all config options
9. **Environment Variables**: All supported env vars
10. **Architecture**: Diagram or description of data flow
11. **Privacy & Security**: Data storage, sensitive patterns, opt-out
12. **Troubleshooting**: Common issues and solutions
13. **Contributing**: How to contribute
14. **License**: AGPL-3.0

### Step 2: Include configuration example
```markdown
## Configuration

open-mem works out of the box with zero configuration. For customization, set environment variables:

```bash
# Required for AI compression (optional — works without it)
export ANTHROPIC_API_KEY=sk-ant-...

# Optional configuration
export OPEN_MEM_MODEL=claude-sonnet-4-20250514
export OPEN_MEM_MAX_CONTEXT_TOKENS=4000
export OPEN_MEM_COMPRESSION=true
export OPEN_MEM_IGNORED_TOOLS=Bash,Glob
```
```

### Step 3: Include architecture diagram (text-based)
```
┌─────────────────────────────────────────────────┐
│                   OpenCode                       │
│                                                  │
│  tool.execute.after ──→ [Tool Capture Hook]      │
│                              │                   │
│                              ▼                   │
│                     [Pending Queue]              │
│                              │                   │
│  session.idle ──────→ [Queue Processor]          │
│                              │                   │
│                              ▼                   │
│                    [AI Compressor] ──→ Anthropic  │
│                              │                   │
│                              ▼                   │
│                    [SQLite + FTS5]                │
│                              │                   │
│  system.transform ←── [Context Injector]         │
│                                                  │
│  mem-search ──────→ [FTS5 Search]                │
│  mem-save ────────→ [Direct Save]                │
│  mem-timeline ────→ [Session Query]              │
└─────────────────────────────────────────────────┘
```

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `README.md` | Create | Full documentation |

## Acceptance Criteria
- [ ] `README.md` exists with all sections listed above
- [ ] Installation instructions are correct (`npm install open-mem` or `bun add open-mem`)
- [ ] Configuration reference lists all environment variables
- [ ] Custom tools are documented with descriptions and argument schemas
- [ ] Architecture overview explains the data flow
- [ ] Privacy section documents data storage location and sensitive pattern filtering
- [ ] Quick start section gets a user from zero to working in < 5 minutes
- [ ] All code examples are syntactically correct
- [ ] License section references AGPL-3.0
- [ ] All validation commands pass

## Validation Commands

```bash
# Verify README exists and has content
wc -l /Users/clopca/dev/github/open-mem/README.md

# Check for required sections
cd /Users/clopca/dev/github/open-mem && grep -c "## " README.md
```

## Notes
- **UX/DX Review needed**: README quality directly impacts adoption and developer experience
- Keep the Quick Start section minimal — users should be able to get started in under 5 minutes
- Include a "How It Works" section for users who want to understand the architecture
- Document the `.open-mem/` directory that gets created in the project root
- Mention adding `.open-mem/` to `.gitignore`
- Consider adding a CHANGELOG.md for version tracking (not required for v0.1.0)
