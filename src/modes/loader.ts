import { join } from "node:path";
import type { ModeConfig } from "../types";
import { type ModeConfigSource, ModeResolverV2 } from "./resolver";

const MODES_DIR = join(import.meta.dir, ".");
const resolver = new ModeResolverV2(MODES_DIR);

let modeCache: Map<string, ModeConfigSource> | null = null;

function loadAllModes(): Map<string, ModeConfigSource> {
	if (modeCache) return modeCache;

	modeCache = resolver.loadAllRaw();
	return modeCache;
}

export function loadMode(modeId: string): ModeConfig {
	return resolver.resolveById(modeId, loadAllModes());
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
