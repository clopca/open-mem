#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { join } from "node:path";

const required = [
	join(process.cwd(), "src/db/schema.ts"),
	join(process.cwd(), "src/db/database.ts"),
	join(process.cwd(), "tests/db/helpers.ts"),
];

for (const file of required) {
	if (!existsSync(file)) {
		console.error(`[migration-compat] required file missing: ${file}`);
		process.exit(1);
	}
}

console.log("[migration-compat] basic migration compatibility checks passed");
