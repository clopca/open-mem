# Benchmark Baseline (Phase 1)

Date: 2026-02-08

Environment:

- Bun `1.3.0`
- macOS Darwin `25.2.0` (arm64)
- Command set:
  - `bun run bench:search`
  - `bun run bench:platform`

## Results

### Search benchmark

- Queries: `4`
- Average latency: `1.07ms`
- P95 latency: `1.68ms`

### Platform normalization benchmark

- Events processed: `20,000`
- Total runtime: `10.94ms`
- Average normalization cost: `0.55us/event`

## Notes

- This is a local baseline for regression tracking and not a cross-machine comparison.
- Re-run these scripts before each release candidate and compare deltas.
