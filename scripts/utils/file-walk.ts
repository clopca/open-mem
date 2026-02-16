import { existsSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export interface FileWalkOptions {
	extensions?: string[];
	ignoredDirNames?: string[];
}

export function walkFiles(rootDir: string, options: FileWalkOptions = {}): string[] {
	if (!existsSync(rootDir)) return [];

	const { extensions, ignoredDirNames = [] } = options;
	const extensionSet = extensions ? new Set(extensions) : null;
	const ignoredDirs = new Set(ignoredDirNames);
	const files: string[] = [];

	const walk = (dir: string): void => {
		const entries = readdirSync(dir).sort((a, b) => a.localeCompare(b));
		for (const entry of entries) {
			if (ignoredDirs.has(entry)) continue;
			const fullPath = join(dir, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (!extensionSet || extensionSet.has(extname(fullPath))) {
				files.push(fullPath);
			}
		}
	};

	walk(rootDir);
	return files;
}
