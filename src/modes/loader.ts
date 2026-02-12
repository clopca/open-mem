import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeConfig } from "../types";

const MODES_DIR = join(import.meta.dir, ".");

let modeCache: Map<string, ModeConfig> | null = null;

function loadAllModes(): Map<string, ModeConfig> {
	if (modeCache) return modeCache;

	modeCache = new Map();

	if (!existsSync(MODES_DIR)) return modeCache;

	for (const file of readdirSync(MODES_DIR)) {
		if (!file.endsWith(".json")) continue;
		try {
			const raw = readFileSync(join(MODES_DIR, file), "utf-8");
			const parsed = JSON.parse(raw) as ModeConfig;
			if (parsed.id && parsed.observationTypes && parsed.conceptVocabulary) {
				modeCache.set(parsed.id, parsed);
			}
		} catch {
			// Skip malformed mode files
		}
	}

	return modeCache;
}

export function loadMode(modeId: string): ModeConfig {
	const modes = loadAllModes();
	const mode = modes.get(modeId);
	if (mode) return mode;

	const fallback = modes.get("code");
	if (fallback) return fallback;

	return {
		id: "code",
		name: "Code",
		description: "Default coding workflow mode",
		observationTypes: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
		conceptVocabulary: [
			"how-it-works",
			"why-it-exists",
			"what-changed",
			"problem-solution",
			"gotcha",
			"pattern",
			"trade-off",
		],
		entityTypes: [
			"technology",
			"library",
			"pattern",
			"concept",
			"file",
			"person",
			"project",
			"other",
		],
		relationshipTypes: [
			"uses",
			"depends_on",
			"implements",
			"extends",
			"related_to",
			"replaces",
			"configures",
		],
	};
}

export function getAvailableModes(): string[] {
	const modes = loadAllModes();
	return [...modes.keys()].sort();
}

export function getDefaultMode(): ModeConfig {
	return loadMode("code");
}

/** Reset the internal cache — useful for tests. */
export function _resetModeCache(): void {
	modeCache = null;
}
