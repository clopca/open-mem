# Quality Gates

All PRs must pass:

1. `bun run typecheck`
2. `bun run lint`
3. `bun run check:boundaries`
4. `bun run check:contracts`
5. `bun run check:architecture`
6. `bun run check:migration` (for storage/contract changes)
7. `bun run quality:gate`

## Change-specific requirements

- API changes:
  - Update schemas and tests.
  - Update docs (`docs/openapi.v1.json`, tool docs).
- Storage changes:
  - Migration test + integrity test.
- Adapter changes:
  - Contract conformance + smoke test.
