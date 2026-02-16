# Quality Gates

All PRs must pass:

1. `bun run typecheck`
2. `bun run lint`
3. `bun run check:boundaries`
4. `bun run quality:gate`
5. Contract checks (`check-contract-drift`)
6. Architecture fitness checks (`check-architecture-fitness`)
7. Migration compatibility checks (`check-migration-compat`) for storage/contract changes

## Change-specific requirements

- API changes:
  - Update schemas and tests.
  - Update docs (`docs/openapi.v1.json`, tool docs).
- Storage changes:
  - Migration test + integrity test.
- Adapter changes:
  - Contract conformance + smoke test.
