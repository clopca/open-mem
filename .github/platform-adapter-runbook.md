# Platform Adapter Runbook

This runbook covers startup, verification, and troubleshooting for Claude Code and Cursor adapter workers.

## Scope

- Adapter workers: `open-mem-claude-code`, `open-mem-cursor`
- Bridge transports: stdio and optional HTTP
- Runtime diagnostics and smoke validation

## Startup

1. Build binaries:
   - `bun run build`
2. Enable adapters:
   - `OPEN_MEM_PLATFORM_CLAUDE_CODE=true`
   - `OPEN_MEM_PLATFORM_CURSOR=true`
3. Start workers:
   - `bunx open-mem-claude-code --project /path/to/project`
   - `bunx open-mem-cursor --project /path/to/project`
4. Optional HTTP mode:
   - `bunx open-mem-claude-code --project /path/to/project --http-port 37877`

## Verification

1. Run integration tests:
   - `bun test tests/integration/platform-worker.test.ts`
   - `bun test tests/integration/platform-parity.test.ts`
2. Validate API/queue/runtime checks:
   - `bun run quality:gate`
   - `bun run test:servers`
3. If HTTP bridge is enabled, verify worker status endpoint:
   - `curl http://localhost:37877/v1/health`

## Troubleshooting

- Worker not ingesting events:
  - Ensure adapter env flag is enabled.
  - Ensure input is newline-delimited JSON.
  - Check for `UNSUPPORTED_EVENT` or `INVALID_JSON` responses.
- HTTP bridge not responding:
  - Confirm port availability.
  - Confirm process is running.
- Queue not draining:
  - Check `/v1/health` and `/v1/metrics`.
  - Run diagnostics endpoint: `GET /v1/diagnostics`.
