// =============================================================================
// open-mem — Git Worktree Detection Tests
// =============================================================================

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCanonicalProjectPath, resolveWorktreeRoot } from "../../src/utils/worktree";

describe("resolveWorktreeRoot", () => {
	test("returns null for a regular (non-worktree) git repo", () => {
		const result = resolveWorktreeRoot(process.cwd());
		expect(result).toBeNull();
	});

	test("returns null for a non-git directory", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "open-mem-test-"));
		try {
			const result = resolveWorktreeRoot(tempDir);
			expect(result).toBeNull();
		} finally {
			rmdirSync(tempDir);
		}
	});

	test("handles non-existent path gracefully", () => {
		const result = resolveWorktreeRoot("/nonexistent/path/that/does/not/exist");
		expect(result).toBeNull();
	});

	test("handles empty string gracefully", () => {
		const result = resolveWorktreeRoot("");
		expect(result).toBeNull();
	});
});

describe("getCanonicalProjectPath", () => {
	test("returns original path for non-worktree directory", () => {
		const tempDir = mkdtempSync(join(tmpdir(), "open-mem-test-"));
		try {
			const result = getCanonicalProjectPath(tempDir);
			expect(result).toBe(tempDir);
		} finally {
			rmdirSync(tempDir);
		}
	});

	test("returns original path for regular git repo", () => {
		const result = getCanonicalProjectPath(process.cwd());
		expect(result).toBe(process.cwd());
	});

	test("returns original path for non-existent directory", () => {
		const fakePath = "/nonexistent/path/xyz";
		const result = getCanonicalProjectPath(fakePath);
		expect(result).toBe(fakePath);
	});
});
