#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, files: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			walk(fullPath, files);
			continue;
		}
		if (fullPath.endsWith(".ts")) files.push(fullPath);
	}
	return files;
}

const coreFiles = walk(join(process.cwd(), "src/core"));
const searchFiles = walk(join(process.cwd(), "src/search"));
const modeFiles = walk(join(process.cwd(), "src/modes"));
const criticalFiles = [...coreFiles, ...searchFiles, ...modeFiles];

const forbidden = [/TODO(?!\s*\(.*issue)/, /FIXME(?!\s*\(.*issue)/];
for (const file of criticalFiles) {
	const content = readFileSync(file, "utf-8");
	for (const regex of forbidden) {
		if (regex.test(content)) {
			console.error(`[architecture-fitness] anonymous TODO/FIXME found in ${file}`);
			process.exit(1);
		}
	}

	if (content.includes("../adapters/") || content.includes("/adapters/")) {
		console.error(`[architecture-fitness] adapter import leaked into core/search/modes: ${file}`);
		process.exit(1);
	}
}

console.log("[architecture-fitness] passed");
