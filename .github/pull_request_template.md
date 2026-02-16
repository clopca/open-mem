## Summary

-

## Quality Gates

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun run check:boundaries`
- [ ] `bun run quality:gate`

## Change Checklist

### API
- [ ] Shared schema updated (if needed)
- [ ] Contract tests updated
- [ ] Docs updated

### Storage
- [ ] Migration compatibility validated
- [ ] Data integrity checks added/updated

### Adapters
- [ ] No duplicated business logic introduced in adapters
- [ ] Contract conformance preserved across MCP/HTTP/OpenCode

### Governance
- [ ] ADR linked for structural changes
