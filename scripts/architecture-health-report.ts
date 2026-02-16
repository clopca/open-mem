#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { walkFiles } from "./utils/file-walk";

const files = walkFiles(join(process.cwd(), "src"), { extensions: [".ts", ".md"] });
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
