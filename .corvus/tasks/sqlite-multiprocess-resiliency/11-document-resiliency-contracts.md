# 11. Document Resiliency Contracts

## Meta
- **ID**: sqlite-multiprocess-resiliency-11
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 3
- **Priority**: P2
- **Depends On**: [sqlite-multiprocess-resiliency-10]
- **Effort**: M (3h)
- **Tags**: [implementation, documentation, operations, dx]
- **Requires UX/DX Review**: true

## Objective
Document the new SQLite resiliency contracts, daemon-aware worker behavior, and maintenance safety procedures for operators and contributors.

## Context
Immutable requirements: **UR-4, UR-5, UR-6, UR-7, UR-8**.

Behavior has shifted from destructive auto-recovery to coordinated fail-safe and explicit maintenance gates. Documentation must describe expected workflows and troubleshooting steps.

**Related Specs**:
- `specs/sqlite-locking-recovery.md`
- `specs/process-coordination.md`
- `specs/platform-worker-daemon-awareness.md`
- `specs/maintenance-safety.md`

## Deliverables
- Updated README (or equivalent docs) describing multi-process safety model
- Maintenance CLI usage updates including preflight and force semantics
- Troubleshooting section for IOERR/lock contention scenarios

## Implementation Steps

### Step 1: Document coordination and startup safety model
Explain no-destructive-startup policy, lock coordination, and daemon-aware behavior.

### Step 2: Document maintenance safety workflow
Add examples for blocked reset, required process shutdown, and explicit force usage.

### Step 3: Add troubleshooting playbook
Include lock contention and `SQLITE_IOERR_*` guidance aligned with fail-fast policy.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `README.md` | Modify | Add resiliency architecture and operational guidance |
| `docs/troubleshooting.md` | Modify | Add maintenance preflight, lock-contention, and `SQLITE_IOERR_*` runbook guidance |

## Tests

### Unit Tests
- **File**: `tests/e2e/build.test.ts`
- **Test**: docs/build pathways remain valid after documentation updates
- **Pattern**: Arrange-Act-Assert
- **Coverage**: documentation integration baseline

### Integration Tests
- **Scenario**: operator follows documented blocked-reset remediation
- **Validation**: documented command sequence matches actual behavior

## Acceptance Criteria

### Scenario: Documentation reflects runtime behavior
- **Given** updated daemon-aware worker and maintenance safety behavior
- **When** documentation is reviewed
- **Then** docs SHALL describe enqueue-only daemon mode and fallback semantics accurately
- **And** docs SHALL describe reset preflight/force behavior accurately

### Scenario: Troubleshooting guidance covers key failure modes
- **Given** SQLite contention or `SQLITE_IOERR_*` errors
- **When** operator follows troubleshooting section
- **Then** guidance SHALL provide safe next steps without destructive defaults
- **And** recommendations SHALL align with implemented commands

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/e2e/build.test.ts

# Build
bun run build
```

## Notes
- Keep docs concise but operationally explicit.
- Include migration note for users previously relying on destructive reset behavior.
