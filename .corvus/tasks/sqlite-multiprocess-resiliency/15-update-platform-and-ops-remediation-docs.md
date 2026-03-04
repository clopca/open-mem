# 15. Update Platform and Ops Remediation Docs

## Meta
- **ID**: sqlite-multiprocess-resiliency-15
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 4
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-14]
- **Effort**: M (2h)
- **Tags**: [implementation, documentation, operations, dx]
- **Requires UX/DX Review**: true

## Objective
Update platform and operational docs with explicit stop/retry command sequences and daemon-aware mode expectations that match runtime behavior.

## Context
Immutable requirements: **UR-4, UR-5, UR-6, UR-8**.

Current docs mention safe reset behavior but do not provide concrete, copy-ready command sequences for stopping/retrying or clearly describe daemon-aware worker mode expectations in platform-facing documentation.

**Related Specs**:
- `specs/platform-worker-daemon-awareness.md`
- `specs/maintenance-safety.md`
- `specs/process-coordination.md`

## Deliverables
- Platform docs section describing `enqueue-only` vs `in-process` expectations and fallback behavior
- Troubleshooting/remediation sections with concrete stop/retry command sequence
- README operational flow updates aligned with CLI output and runtime behavior

## Implementation Steps

### Step 1: Add daemon-aware mode expectations to platform docs
Document expected worker health output and when mode is `enqueue-only` versus `in-process`.

### Step 2: Add concrete stop/retry remediation sequence
Add explicit command sequence for stopping daemon/workers, rerunning `reset-db`, and controlled `--force` fallback.

### Step 3: Align docs with current CLI wording
Ensure remediation text and examples match actual maintenance CLI output and supported commands.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `README.md` | Modify | Add explicit remediation command sequence and daemon-aware expectations |
| `docs/platforms.md` | Modify | Add daemon-aware worker mode contract and operational expectations |
| `docs/troubleshooting.md` | Modify | Add concrete stop/retry workflow and daemon-aware checks |

## Tests

### Unit Tests
- **File**: `tests/e2e/build.test.ts`
- **Test**: docs/build pathways remain valid after documentation updates
- **Pattern**: Arrange-Act-Assert
- **Coverage**: docs integration baseline

### Integration Tests
- **Scenario**: remediation command sequence in docs matches maintenance CLI behavior
- **Validation**: docs parity assertions pass against command output and health semantics

## Acceptance Criteria

### Scenario: Platform docs describe daemon-aware worker expectations
- **Given** platform adapter documentation
- **When** daemon-aware behavior section is reviewed
- **Then** docs SHALL define `enqueue-only` and `in-process` mode expectations
- **And** docs SHALL describe fallback behavior when daemon signaling/liveness fails

### Scenario: Ops docs provide concrete remediation sequence
- **Given** a blocked `reset-db` case with active processes
- **When** operator follows documented commands
- **Then** docs SHALL include explicit stop, retry, and force-override command examples
- **And** command sequence SHALL align with supported CLI behavior

### Scenario: Validation baseline
- **Given** doc updates are complete
- **When** validation commands run
- **Then** targeted tests SHALL pass
- **And** typecheck, lint, and build SHALL pass

## Validation Commands

```bash
# Run docs + maintenance parity tests
bun test tests/integration/maintenance-cli.test.ts tests/e2e/build.test.ts

# Type check
bun run typecheck

# Lint
bun run lint

# Build
bun run build
```

## Notes
- Keep examples copy/paste-ready and project-scoped.
- Avoid introducing destructive guidance that bypasses maintenance preflight by default.
