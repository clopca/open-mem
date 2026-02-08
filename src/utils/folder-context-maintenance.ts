import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ObservationStore, SessionStore } from "../store/ports";
import { updateFolderContext } from "./agents-md";

const START_TAG = "<!-- open-mem-context -->";
const END_TAG = "<!-- /open-mem-context -->";

async function walk(dir: string, out: string[]): Promise<void> {
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
			await walk(full, out);
		} else if (entry.isFile() && name === "AGENTS.md") {
			out.push(full);
		}
	}
}

export async function findAgentsMdFiles(projectPath: string): Promise<string[]> {
	const root = resolve(projectPath);
	const out: string[] = [];
	await walk(root, out);
	return out;
}

export function removeManagedSection(content: string): string {
	const start = content.indexOf(START_TAG);
	const end = content.indexOf(END_TAG);
	if (start === -1 || end === -1 || end <= start) return content;
	const before = content.slice(0, start).trimEnd();
	const after = content.slice(end + END_TAG.length).trimStart();
	if (!before && !after) return "";
	if (!before) return `${after}\n`;
	if (!after) return `${before}\n`;
	return `${before}\n\n${after}\n`;
}

export async function cleanFolderContext(
	projectPath: string,
	dryRun = false,
): Promise<{ files: string[]; changed: number }> {
	const files = await findAgentsMdFiles(projectPath);
	let changed = 0;
	for (const file of files) {
		const existing = await readFile(file, "utf-8");
		const cleaned = removeManagedSection(existing);
		if (cleaned !== existing) {
			changed += 1;
			if (!dryRun) {
				await writeFile(file, cleaned, "utf-8");
			}
		}
	}
	return { files, changed };
}

export async function rebuildFolderContext(
	projectPath: string,
	sessions: SessionStore,
	observations: ObservationStore,
	maxDepth: number,
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

	await updateFolderContext(projectPath, allObservations, maxDepth);
	const files = await findAgentsMdFiles(projectPath);
	return { observations: allObservations.length, filesTouched: files.length };
}
