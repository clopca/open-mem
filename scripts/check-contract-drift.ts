#!/usr/bin/env bun

import { TOOL_CONTRACTS } from "../src/contracts/schemas";

const expected = [
	"mem-find",
	"mem-history",
	"mem-get",
	"mem-create",
	"mem-revise",
	"mem-remove",
	"mem-export",
	"mem-import",
	"mem-maintenance",
	"mem-help",
];

const actual = TOOL_CONTRACTS.map((tool) => tool.name);

if (actual.length !== expected.length || expected.some((tool) => !actual.includes(tool))) {
	console.error("[contract-drift] Tool contract list drift detected.");
	console.error("expected:", expected.join(", "));
	console.error("actual:", actual.join(", "));
	process.exit(1);
}

for (const tool of TOOL_CONTRACTS) {
	if (!tool.description || tool.description.trim().length < 10) {
		console.error(`[contract-drift] Missing or too-short description for ${tool.name}`);
		process.exit(1);
	}
}

console.log("[contract-drift] passed");
