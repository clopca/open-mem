#!/usr/bin/env bun

import { resolve } from "node:path";

const checks = [
  ["bun", "test", "search/quality-regression.test.ts"],
  ["bun", "test", "search/latency-budget.test.ts"],
];
const testsCwd = resolve(process.cwd(), "tests");

for (const cmd of checks) {
  const proc = Bun.spawnSync(cmd, { cwd: testsCwd, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    console.error(`[quality-gate] failed in tests/: ${cmd.join(" ")}`);
    process.exit(proc.exitCode ?? 1);
  }
}

console.log("[quality-gate] passed");
