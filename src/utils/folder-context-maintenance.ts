import { existsSync } from "node:fs";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ObservationStore, SessionStore } from "../store/ports";
import { updateFolderContext } from "./agents-md";

const START_TAG = "<!-- open-mem-context -->";
const END_TAG = "<!-- /open-mem-context -->";

async function walk(dir: string, filename: string, out: string[]): Promise<void> {
	let entries: Array<import("node:fs").Dirent>;
	try {
		entries = await readdir(dir, { withFileTypes: true, encoding: "utf8" });
	} catch {
		return;
	}

	for (const entry of entries) {
		const name = String(entry.name);
		if (name === ".git" || name === "node_modules" || name === ".open-mem" || name === "dist") {
			continue;
		}
		const full = join(dir, name);
		if (entry.isDirectory()) {
			await walk(full, filename, out);
		} else if (entry.isFile() && name === filename) {
			out.push(full);
		}
	}
}

export async function findAgentsMdFiles(projectPath: string, filename: string): Promise<string[]> {
	const root = resolve(projectPath);
	const out: string[] = [];
	await walk(root, filename, out);
	return out;
}

export function removeManagedSection(content: string): string {
	const start = content.indexOf(START_TAG);
	const end = content.indexOf(END_TAG);
	// No tags at all → return unchanged
	if (start === -1 && end === -1) return content;
	// Corrupted: only start tag, only end tag, or reversed → strip orphans
	if (start !== -1 && end === -1) {
		const cleaned = content.replace(START_TAG, "").trim();
		return cleaned ? `${cleaned}\n` : "";
	}
	if (start === -1 && end !== -1) {
		const cleaned = content.replace(END_TAG, "").trim();
		return cleaned ? `${cleaned}\n` : "";
	}
	if (end <= start) {
		const cleaned = content.replace(START_TAG, "").replace(END_TAG, "").trim();
		return cleaned ? `${cleaned}\n` : "";
	}
	const before = content.slice(0, start).trimEnd();
	const after = content.slice(end + END_TAG.length).trimStart();
	if (!before && !after) return "";
	if (!before) return `${after}\n`;
	if (!after) return `${before}\n`;
	return `${before}\n\n${after}\n`;
}

export async function cleanFolderContext(
	projectPath: string,
	filename: string,
	dryRun = false,
): Promise<{ files: string[]; changed: number }> {
	const files = await findAgentsMdFiles(projectPath, filename);
	let changed = 0;
	for (const file of files) {
		const existing = await readFile(file, "utf-8");
		const cleaned = removeManagedSection(existing);
		if (cleaned !== existing) {
			changed += 1;
			if (!dryRun) {
				if (cleaned === "") {
					await unlink(file);
				} else {
					await writeFile(file, cleaned, "utf-8");
				}
			}
		}
	}
	// Also clean root file (for single mode)
	if (filename) {
		const rootFile = join(resolve(projectPath), filename);
		if (existsSync(rootFile)) {
			try {
				const existing = await readFile(rootFile, "utf-8");
				const cleaned = removeManagedSection(existing);
				if (cleaned !== existing) {
					changed += 1;
					if (!dryRun) {
						if (cleaned === "") {
							await unlink(rootFile);
						} else {
							await writeFile(rootFile, cleaned, "utf-8");
						}
					}
				}
				if (!files.includes(rootFile)) files.push(rootFile);
			} catch {
				// Root file doesn't exist
			}
		}
	}

	return { files, changed };
}

export async function purgeFolderContext(
	projectPath: string,
	filename: string,
): Promise<{ deleted: number; files: string[] }> {
	const files = await findAgentsMdFiles(projectPath, filename);

	// Also check for root file (in single mode)
	if (filename) {
		const rootFile = join(resolve(projectPath), filename);
		if (existsSync(rootFile) && !files.includes(rootFile)) {
			files.push(rootFile);
		}
	}

	let deleted = 0;
	for (const file of files) {
		try {
			await unlink(file);
			deleted++;
		} catch {
			// File already gone
		}
	}
	return { deleted, files };
}

export async function rebuildFolderContext(
	projectPath: string,
	sessions: SessionStore,
	observations: ObservationStore,
	options: { maxDepth: number; mode: "dispersed" | "single"; filename: string },
	dryRun = false,
): Promise<{ observations: number; filesTouched: number }> {
	const allSessions = sessions.getAll(projectPath);
	const allObservations = allSessions.flatMap((session) => observations.getBySession(session.id));

	if (dryRun) {
		const filesTouched = new Set<string>();
		for (const obs of allObservations) {
			for (const f of [...obs.filesRead, ...obs.filesModified]) filesTouched.add(f);
		}
		return { observations: allObservations.length, filesTouched: filesTouched.size };
	}

	if (!existsSync(projectPath)) {
		return { observations: 0, filesTouched: 0 };
	}

	await updateFolderContext(projectPath, allObservations, {
		maxDepth: options.maxDepth,
		mode: options.mode,
		filename: options.filename,
	});
	const files = await findAgentsMdFiles(projectPath, options.filename);
	return { observations: allObservations.length, filesTouched: files.length };
}
