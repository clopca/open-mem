import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { walkFiles } from "../../scripts/utils/file-walk";

const tempDirs: string[] = [];

function mkTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "open-mem-file-walk-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("walkFiles", () => {
	test("returns empty list for missing directory", () => {
		const missing = join(tmpdir(), "open-mem-file-walk-missing");
		expect(walkFiles(missing, { extensions: [".ts"] })).toEqual([]);
	});

	test("walks nested trees recursively with extension filters", () => {
		const root = mkTempDir();
		mkdirSync(join(root, "src", "nested"), { recursive: true });
		writeFileSync(join(root, "src", "index.ts"), "");
		writeFileSync(join(root, "src", "nested", "notes.md"), "");
		writeFileSync(join(root, "src", "nested", "readme.txt"), "");

		const result = walkFiles(join(root, "src"), { extensions: [".ts", ".md"] });
		expect(result).toEqual([
			join(root, "src", "index.ts"),
			join(root, "src", "nested", "notes.md"),
		]);
	});

	test("produces deterministic sorted output", () => {
		const root = mkTempDir();
		mkdirSync(join(root, "src", "b"), { recursive: true });
		mkdirSync(join(root, "src", "a"), { recursive: true });
		writeFileSync(join(root, "src", "b", "z.ts"), "");
		writeFileSync(join(root, "src", "a", "m.ts"), "");
		writeFileSync(join(root, "src", "a", "a.ts"), "");

		const result = walkFiles(join(root, "src"), { extensions: [".ts"] });
		expect(result).toEqual([
			join(root, "src", "a", "a.ts"),
			join(root, "src", "a", "m.ts"),
			join(root, "src", "b", "z.ts"),
		]);
	});

	test("skips ignored directories", () => {
		const root = mkTempDir();
		mkdirSync(join(root, "src", "node_modules"), { recursive: true });
		mkdirSync(join(root, "src", "app"), { recursive: true });
		writeFileSync(join(root, "src", "node_modules", "ignored.ts"), "");
		writeFileSync(join(root, "src", "app", "kept.ts"), "");

		const result = walkFiles(join(root, "src"), {
			extensions: [".ts"],
			ignoredDirNames: ["node_modules"],
		});
		expect(result).toEqual([join(root, "src", "app", "kept.ts")]);
	});
});
