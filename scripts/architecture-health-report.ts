#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) walk(full, files);
		else if (full.endsWith(".ts") || full.endsWith(".md")) files.push(full);
	}
	return files;
}

const files = walk(join(process.cwd(), "src"));
let todoCount = 0;
let fixmeCount = 0;

for (const file of files) {
	const content = readFileSync(file, "utf-8");
	todoCount += (content.match(/\bTODO\b/g) ?? []).length;
	fixmeCount += (content.match(/\bFIXME\b/g) ?? []).length;
}

const report = {
	generatedAt: new Date().toISOString(),
	sourceFiles: files.length,
	todoCount,
	fixmeCount,
};

console.log(JSON.stringify(report, null, 2));
