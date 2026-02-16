#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkFiles } from "./utils/file-walk";

function listTsFilesIfPresent(dir: string): string[] {
	return walkFiles(dir, { extensions: [".ts"] });
}

function hasAdapterImportLeak(content: string): boolean {
	const patterns = [
		/\bfrom\s+["'][^"']*\/adapters\/[^"']*["']/,
		/\bimport\(\s*["'][^"']*\/adapters\/[^"']*["']\s*\)/,
		/\brequire\(\s*["'][^"']*\/adapters\/[^"']*["']\s*\)/,
	];
	return patterns.some((pattern) => pattern.test(content));
}

const coreFiles = listTsFilesIfPresent(join(process.cwd(), "src/core"));
const searchFiles = listTsFilesIfPresent(join(process.cwd(), "src/search"));
const modeFiles = listTsFilesIfPresent(join(process.cwd(), "src/modes"));
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

	if (hasAdapterImportLeak(content)) {
		console.error(`[architecture-fitness] adapter import leaked into core/search/modes: ${file}`);
		process.exit(1);
	}
}

console.log("[architecture-fitness] passed");
