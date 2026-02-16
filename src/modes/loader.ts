import { join } from "node:path";
import type { ModeConfig } from "../types";
import { getDefaultModeConfig, ModeResolverV2 } from "./resolver";

const MODES_DIR = join(import.meta.dir, ".");

let modeCache: Map<string, ModeConfig> | null = null;

function loadAllModes(): Map<string, ModeConfig> {
	if (modeCache) return modeCache;

	const resolver = new ModeResolverV2(MODES_DIR);
	modeCache = resolver.loadAllRaw();
	return modeCache;
}

export function loadMode(modeId: string): ModeConfig {
	const resolver = new ModeResolverV2(MODES_DIR);
	return resolver.resolveById(modeId, loadAllModes());
}

export function getAvailableModes(): string[] {
	const modes = loadAllModes();
	return [...modes.keys()].sort();
}

export function getDefaultMode(): ModeConfig {
	return loadMode("code") ?? getDefaultModeConfig();
}

/** Reset the internal cache — useful for tests. */
export function _resetModeCache(): void {
	modeCache = null;
}
