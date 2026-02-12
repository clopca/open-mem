#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOTS = [join(process.cwd(), "src"), join(process.cwd(), "dashboard", "src")];

const DEPRECATED_PATTERNS = ["/servers/", "/legacy/", "/deprecated/"];

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	try {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			const stat = statSync(full);
			if (stat.isDirectory()) out.push(...listTsFiles(full));
			else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
		}
	} catch {
		// directory may not exist
	}
	return out;
}

function rel(file: string): string {
	return relative(process.cwd(), file).split(sep).join("/");
}

const files = ROOTS.flatMap((root) => listTsFiles(root));
const errors: string[] = [];

for (const file of files) {
	const content = readFileSync(file, "utf-8");
	const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
	const r = rel(file);

	for (const imp of imports) {
		for (const pattern of DEPRECATED_PATTERNS) {
			if (imp.includes(pattern)) {
				errors.push(`${r}: imports deprecated path "${pattern}" via "${imp}"`);
			}
		}
	}
}

if (errors.length > 0) {
	console.error("Deprecated path violations:\n" + errors.join("\n"));
	process.exit(1);
}

console.log("Deprecated path scan passed.");
