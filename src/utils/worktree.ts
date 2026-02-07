// =============================================================================
// open-mem — Git Worktree Detection
// =============================================================================

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";

/**
 * Resolve the main repository root if the given directory is inside a git worktree.
 *
 * @param projectDir - Absolute path to the project directory
 * @returns The main repo root path if inside a worktree, or `null` if not a worktree
 */
export function resolveWorktreeRoot(projectDir: string): string | null {
	try {
		const commonResult = spawnSync("git", ["rev-parse", "--git-common-dir"], {
			cwd: projectDir,
			encoding: "utf-8",
			timeout: 5000,
		});

		if (commonResult.status !== 0 || !commonResult.stdout) {
			return null;
		}

		const commonDir = commonResult.stdout.trim();

		// Normal repo returns ".git" (relative); worktree returns absolute path
		if (commonDir === ".git") {
			return null;
		}

		const gitDirResult = spawnSync("git", ["rev-parse", "--git-dir"], {
			cwd: projectDir,
			encoding: "utf-8",
			timeout: 5000,
		});

		if (gitDirResult.status !== 0 || !gitDirResult.stdout) {
			return null;
		}

		const gitDir = gitDirResult.stdout.trim();

		// If git-dir equals git-common-dir, not a worktree
		const resolvedCommon = resolve(projectDir, commonDir);
		const resolvedGitDir = resolve(projectDir, gitDir);

		if (resolvedCommon === resolvedGitDir) {
			return null;
		}

		// common-dir is /path/to/parent/.git — parent root is its dirname
		const parentRoot = dirname(resolvedCommon);

		if (parentRoot === resolvedCommon || parentRoot === "/") {
			return null;
		}

		return parentRoot;
	} catch {
		return null;
	}
}

/** Returns worktree root if in a worktree, otherwise the original projectDir. */
export function getCanonicalProjectPath(projectDir: string): string {
	const worktreeRoot = resolveWorktreeRoot(projectDir);
	return worktreeRoot ?? projectDir;
}
