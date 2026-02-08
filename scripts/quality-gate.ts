#!/usr/bin/env bun

const checks = [
  ["bun", "test", "tests/search/quality-regression.test.ts"],
  ["bun", "test", "tests/search/latency-budget.test.ts"],
];

for (const cmd of checks) {
  const proc = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error(`[quality-gate] failed: ${cmd.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
}

console.log("[quality-gate] passed");
