// =============================================================================
// open-mem — Bun PATH Resolution
// =============================================================================

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Common Bun install locations to scan when `Bun.which("bun")` fails.
 * This handles environments where PATH doesn't include the Bun binary
 * (e.g., GUI apps that don't inherit shell PATH).
 */
function getCandidatePaths(): string[] {
	const candidates: string[] = [];

	// BUN_INSTALL env takes priority — user explicitly set it
	const bunInstall = process.env.BUN_INSTALL;
	if (bunInstall) {
		candidates.push(join(bunInstall, "bin", "bun"));
	}

	const home = homedir();

	// Standard Bun install location (~/.bun/bin/bun)
	candidates.push(join(home, ".bun", "bin", "bun"));

	// System-wide locations
	candidates.push("/usr/local/bin/bun");

	// macOS ARM Homebrew
	candidates.push("/opt/homebrew/bin/bun");

	// Linux Homebrew
	candidates.push("/home/linuxbrew/.linuxbrew/bin/bun");

	return candidates;
}

/**
 * Resolve the full path to the Bun executable.
 *
 * 1. Tries `Bun.which("bun")` (uses PATH)
 * 2. Scans common install locations via `existsSync`
 * 3. Falls back to bare `"bun"` (let the OS try PATH at spawn time)
 */
export function resolveBunPath(): string {
	const fromWhich = Bun.which("bun");
	if (fromWhich) {
		return fromWhich;
	}

	for (const candidate of getCandidatePaths()) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	return "bun";
}

/** Cached result — only resolve once per process. */
let cachedBunPath: string | null = null;

/**
 * Cached version of `resolveBunPath()`. Resolves once, returns the same
 * result for all subsequent calls within the same process.
 */
export function resolveBunPathCached(): string {
	if (cachedBunPath === null) {
		cachedBunPath = resolveBunPath();
	}
	return cachedBunPath;
}

/**
 * Reset the cached Bun path. Exposed for testing only.
 * @internal
 */
export function _resetBunPathCache(): void {
	cachedBunPath = null;
}
