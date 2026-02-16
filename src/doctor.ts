#!/usr/bin/env bun

import { parseArgs } from "node:util";
import { resolveConfig } from "./config";
import { DefaultSetupDiagnosticsService } from "./services/setup-diagnostics";
import { getCanonicalProjectPath } from "./utils/worktree";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		project: { type: "string", short: "p" },
		json: { type: "boolean", default: false },
	},
	strict: false,
});

const projectDir = typeof values.project === "string" ? values.project : process.cwd();
const projectPath = getCanonicalProjectPath(projectDir);
const config = resolveConfig(projectPath);
const result = new DefaultSetupDiagnosticsService().run(config);

if (values.json) {
	console.log(JSON.stringify(result, null, 2));
	process.exit(result.ok ? 0 : 1);
}

for (const check of result.checks) {
	const icon = check.status === "pass" ? "✅" : check.status === "warn" ? "⚠️" : "❌";
	console.log(`${icon} ${check.id}: ${check.message}`);
	if (check.details) {
		console.log(`   ${JSON.stringify(check.details)}`);
	}
}

if (!result.ok) {
	console.error("\nopen-mem doctor found blocking issues.");
	process.exit(1);
}

console.log("\nopen-mem doctor: all critical checks passed.");
