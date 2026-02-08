#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(process.cwd(), "src");

function listTsFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...listTsFiles(full));
		else if (entry.endsWith(".ts")) out.push(full);
	}
	return out;
}

function rel(file: string): string {
	return relative(process.cwd(), file).split(sep).join("/");
}

const files = listTsFiles(ROOT);
const errors: string[] = [];

for (const file of files) {
	const content = readFileSync(file, "utf-8");
	const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
	const r = rel(file);
	const inAdapters = r.startsWith("src/adapters/");
	const inCore = r.startsWith("src/core/");
	const inStore = r.startsWith("src/store/");

	for (const imp of imports) {
		if (inAdapters && imp.includes("/db/")) {
			errors.push(`${r}: adapters must not import db directly (${imp})`);
		}
		if (inAdapters && imp.includes("/servers/")) {
			errors.push(`${r}: adapters must not import legacy servers layer (${imp})`);
		}
		if (inCore && (imp.includes("/adapters/") || imp.includes("/servers/") || imp.includes("/dashboard/"))) {
			errors.push(`${r}: core must not import adapters/servers/dashboard (${imp})`);
		}
		if (r.startsWith("src/runtime/") && (imp.includes("/adapters/") || imp.includes("/servers/") || imp.includes("/db/"))) {
			errors.push(`${r}: runtime must not import adapters/servers/db directly (${imp})`);
		}
		const isCompositionRoot = r === "src/index.ts" || r === "src/mcp.ts" || r === "src/daemon.ts";
		if (!inStore && !isCompositionRoot && imp.includes("/store/sqlite/")) {
			errors.push(`${r}: only store layer may import sqlite store implementations (${imp})`);
		}
	}
}

if (errors.length > 0) {
	console.error("Import boundary violations:\n" + errors.join("\n"));
	process.exit(1);
}

console.log("Import boundaries check passed.");
