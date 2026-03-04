# 05. Wire Locks Through Process Roles

## Meta
- **ID**: sqlite-multiprocess-resiliency-05
- **Feature**: sqlite-multiprocess-resiliency
- **Phase**: 2
- **Priority**: P1
- **Depends On**: [sqlite-multiprocess-resiliency-03]
- **Effort**: M (2h)
- **Tags**: [implementation, coordination, backend, daemon]
- **Requires UX/DX Review**: false

## Objective
Integrate advisory lock coordination and process-role metadata across plugin, daemon, platform workers, and maintenance entrypoints.

## Context
Immutable requirements: **UR-1, UR-3, UR-6, UR-8**.

Coordination must apply consistently to all writer process types, not only DB helper callsites. This task introduces role-aware wiring so diagnostics and lock semantics are coherent system-wide.

**Related Specs**:
- `specs/process-coordination.md` - Process Role Model
- `specs/sqlite-locking-recovery.md` - Write Transaction Model

## Deliverables
- Role metadata propagation in DB initialization pathways
- Shared coordination wiring for plugin, daemon, platform-worker, maintenance
- Standardized contention/error diagnostics by process role

## Implementation Steps

### Step 1: Define role identifiers and wiring contract
Introduce consistent role IDs and attach them where database instances are created.

### Step 2: Update process entrypoints
Integrate role metadata in `src/index.ts`, `src/daemon.ts`, `src/platform-worker.ts`, and `src/maintenance.ts` DB setup paths.

### Step 3: Align diagnostics
Ensure lock timeout/contention logs include process role for troubleshooting.

## Files to Change

| File | Action | Changes |
|------|--------|---------|
| `src/db/database.ts` | Modify | Accept/process role metadata and expose it to lock diagnostics |
| `src/index.ts` | Modify | Pass plugin role metadata into DB setup |
| `src/daemon.ts` | Modify | Pass daemon role metadata into DB setup |
| `src/platform-worker.ts` | Modify | Pass platform worker role metadata into DB setup |
| `src/maintenance.ts` | Modify | Pass maintenance role metadata into DB setup |

## Tests

### Unit Tests
- **File**: `tests/db/database.test.ts`
- **Test**: role metadata appears in lock diagnostics and configured db instance behavior
- **Pattern**: Arrange-Act-Assert
- **Coverage**: database role-aware coordination path

### Integration Tests
- **Scenario**: plugin + daemon contention logs identify role source
- **Validation**: role labels appear in emitted diagnostics

## Acceptance Criteria

### Scenario: All process roles attach coordination metadata
- **Given** each runtime entrypoint (plugin, daemon, both platform workers, maintenance)
- **When** a database instance is created
- **Then** process role metadata SHALL be attached consistently
- **And** coordination diagnostics SHALL include the originating role

### Scenario: Role-aware diagnostics aid contention debugging
- **Given** lock contention occurs
- **When** lock acquisition fails/times out
- **Then** error output SHALL include role metadata
- **And** output SHALL be consistent across entrypoints

## Validation Commands

```bash
# Type check
bun run typecheck

# Lint
bun run lint

# Run specific tests
bun test tests/db/database.test.ts tests/daemon/manager.test.ts

# Build
bun run build
```

## Notes
- Keep role naming stable; it will be referenced in runbooks and support diagnostics.
