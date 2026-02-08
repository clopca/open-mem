# External Compatibility Verification Summary

- Generated: 2026-02-08T01:07:27.649Z
- Git SHA: 15066cc3ef6b65b46c3427c59cc92a1e4b56f66b
- Runner: local
- MCP tool call p95: 111.18ms (target < 250ms)
- Worker ingest p95: 7.13ms (target < 100ms)
- Failure rate: 0 (target < 0.01)

## Client Status
- claude-code: supported (version=2.0.76; limitations=None.)
- cursor: supported (version=2.4.28; limitations=None.)

## Failure Taxonomy
- CLIENT_PROTOCOL_DRIFT: Lifecycle or JSON-RPC behavior mismatch with claimed protocol contract.
- WORKER_BRIDGE_REGRESSION: Platform worker bridge command/transport behavior mismatch.
- ENVIRONMENT_DEPENDENCY: Client binary/version unavailable or runtime dependency missing on runner.
- NON_DETERMINISTIC_OUTPUT: Unstable output shape prevents deterministic verification.
