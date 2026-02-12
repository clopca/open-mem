# Platform Adapter Runbook

This runbook covers operational startup, verification, and troubleshooting for Claude Code/Cursor adapter workers and compatibility validation.

## Scope

- Adapter workers: `open-mem-claude-code`, `open-mem-cursor`
- Bridge transports: stdio + optional HTTP
- External compatibility evidence workflow and release gate

## Startup (Ops-Safe)

1. Build binaries:
   - `bun run build`
2. Enable adapters:
   - `OPEN_MEM_PLATFORM_CLAUDE_CODE=true`
   - `OPEN_MEM_PLATFORM_CURSOR=true`
3. Start workers (one process per platform):
   - `bunx open-mem-claude-code --project /path/to/project`
   - `bunx open-mem-cursor --project /path/to/project`
4. Optional HTTP mode for bridge checks:
   - `bunx open-mem-claude-code --project /path/to/project --http-port 37877`

## Verification Workflow

1. Run external verification harness:
   - `bun run compat:verify --artifacts-dir artifacts/external-compat`
   - Auto-detect installed client versions and run verification:
   - `bun run compat:verify:auto --artifacts-dir artifacts/external-compat`
2. Render matrix from latest report:
   - `bun run compat:matrix`
3. Run worker bridge smoke checks:
   - `bun run compat:smoke --artifacts-dir artifacts/external-compat`
4. Check release gate:
   - `bun run compat:gate`

## Evidence Contract

Each verification run must produce:

- `external-compat-report.json`
- `transcripts/<client>/<scenario>.jsonl`
- `logs/<client>.log`
- `summary.md`
- `checksums.txt`

CI bundles these as `external-compat-<run-id>.zip`.

## Failure Taxonomy

### `CLIENT_PROTOCOL_DRIFT`

- Trigger: MCP lifecycle/JSON-RPC mismatch.
- Remediation: patch MCP compatibility handling; add/update transcript fixtures; rerun verify.

### `WORKER_BRIDGE_REGRESSION`

- Trigger: `health`/`flush`/`shutdown` semantics or bridge transport failures.
- Remediation: patch `src/platform-worker.ts`; rerun smoke script; add targeted integration regression.

### `ENVIRONMENT_DEPENDENCY`

- Trigger: missing client binaries/version metadata on runner.
- Remediation: fix runner provisioning and version export (`OPEN_MEM_CLAUDE_CODE_VERSION`, `OPEN_MEM_CURSOR_VERSION`).

### `NON_DETERMINISTIC_OUTPUT`

- Trigger: unstable output/transcript causing assertion flake.
- Remediation: normalize volatile fields and tighten deterministic assertions.

## Troubleshooting

- `ENV_MISSING_DIST_*`: run `bun run build` before verification scripts.
- `STALE_REPORT`: regenerate report with `compat:verify`; commit updated `docs/compatibility/external-compat-latest.json`.
- `MATRIX_MISMATCH`: run `compat:matrix` and commit updated `docs/mcp-compatibility-matrix.md`.
- `CLIENT_VERSION_UNKNOWN`: run `bun run compat:detect-versions` to inspect what is detected, then ensure relevant CLI/app is installed on the runner.
- Worker HTTP failures: verify port availability and local firewall constraints on runner host.

## Soak Procedure (7-Day)

- Run `external-compat` workflow nightly for 7 consecutive days.
- Publish weekly soak summary file:
  - `docs/compatibility/soak-YYYY-MM-DD.md`
- GA requires:
  - 7 successful runs,
  - p95 targets met (`MCP < 250ms`, `worker ingest < 100ms`),
  - failure rate < 1%.
