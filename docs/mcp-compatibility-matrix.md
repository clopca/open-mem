# MCP Compatibility Matrix

This matrix tracks observed compatibility of `open-mem` MCP behavior across clients.

## Verification Policy

A client row is marked `Supported` only when all of the following are true:

- Latest stable client version is captured in verification evidence.
- Required external scenario suite passes on self-hosted macOS runner.
- Evidence bundle is attached to CI (`external-compat-<run-id>.zip`) and machine-parseable.
- Known limitations section is explicit (can be `None.`).
- Verification evidence age is <= 7 days at release time.

Platform scope for this matrix is currently **macOS-only verification**. Other OS targets remain unverified until dedicated runs are added.

<!-- external-compat:generated:start -->
| Client | Transport | Protocol Version | Client Version | Status | Verified On | Notes | Known Limitations |
|---|---|---:|---|---|---|---|---|
| OpenCode MCP client | stdio | 2024-11-05 | n/a | Supported | Internal regression suite | Full lifecycle and transcript harness coverage. | None. |
| Claude Code MCP integration | stdio | 2024-11-05 | 2.0.76 | Supported | 2026-02-08T01:07:27.649Z | 4/4 required scenarios passed | None. |
| Cursor MCP integration | stdio | 2024-11-05 | 2.4.28 | Supported | 2026-02-08T01:07:27.649Z | 4/4 required scenarios passed | None. |
<!-- external-compat:generated:end -->

## Compatibility Rules

- `initialize` negotiates protocol version and rejects unsupported versions with JSON-RPC `-32602`.
- `notifications/initialized` is accepted as notification (no response body).
- In `strict` mode, methods other than `initialize` are rejected before initialization (`-32002`).
- Tool parameter validation errors are returned as structured `VALIDATION_ERROR` envelopes in MCP tool results.
- Unknown RPC methods return JSON-RPC `-32601`.

## Required External Scenarios

- Happy path handshake + tool call.
- Strict pre-init rejection.
- Validation error determinism.
- Unknown method mapping.
- Worker invalid JSON handling + recovery.
- Session ingest parity outcome check.

## Test Coverage

Internal coverage remains in:

- `tests/servers/mcp-server.test.ts`
- `tests/servers/mcp-transcripts.test.ts`
- `tests/integration/platform-parity.test.ts`
- `tests/integration/platform-worker.test.ts`
