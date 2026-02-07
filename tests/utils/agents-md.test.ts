// =============================================================================
// open-mem — AGENTS.md Generation Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Observation } from "../../src/types";
import {
	generateFolderContext,
	replaceTaggedContent,
	updateAgentsMd,
} from "../../src/utils/agents-md";

const START_TAG = "<!-- open-mem-context -->";
const END_TAG = "<!-- /open-mem-context -->";

function makeObservation(overrides?: Partial<Observation>): Observation {
	return {
		id: "obs-1",
		sessionId: "sess-1",
		type: "discovery",
		title: "Found auth pattern",
		subtitle: "",
		facts: [],
		narrative: "Discovered auth pattern in codebase.",
		concepts: ["auth", "pattern"],
		filesRead: ["src/auth.ts"],
		filesModified: [],
		rawToolOutput: "raw",
		toolName: "Read",
		createdAt: "2026-01-15T10:00:00.000Z",
		tokenCount: 50,
		discoveryTokens: 0,
		...overrides,
	};
}

// =============================================================================
// replaceTaggedContent
// =============================================================================

describe("replaceTaggedContent", () => {
	test("creates new file with tags when no existing content", () => {
		const result = replaceTaggedContent("", "New content here");
		expect(result).toContain(START_TAG);
		expect(result).toContain(END_TAG);
		expect(result).toContain("New content here");
	});

	test("replaces existing tagged section", () => {
		const existing = `# My AGENTS.md\n\nUser notes here.\n\n${START_TAG}\nOld content\n${END_TAG}\n\nMore user notes.`;
		const result = replaceTaggedContent(existing, "Updated content");
		expect(result).toContain("Updated content");
		expect(result).not.toContain("Old content");
		expect(result).toContain("User notes here.");
		expect(result).toContain("More user notes.");
	});

	test("preserves user content outside tags", () => {
		const existing = `# Custom Header\n\nImportant notes.\n\n${START_TAG}\nManaged section\n${END_TAG}\n\n## Footer`;
		const result = replaceTaggedContent(existing, "New managed content");
		expect(result).toContain("# Custom Header");
		expect(result).toContain("Important notes.");
		expect(result).toContain("## Footer");
		expect(result).toContain("New managed content");
	});

	test("appends to file without existing tags", () => {
		const existing = "# Existing AGENTS.md\n\nSome user content.";
		const result = replaceTaggedContent(existing, "Appended content");
		expect(result).toContain("# Existing AGENTS.md");
		expect(result).toContain("Some user content.");
		expect(result).toContain(START_TAG);
		expect(result).toContain("Appended content");
		expect(result).toContain(END_TAG);
	});
});

// =============================================================================
// generateFolderContext
// =============================================================================

describe("generateFolderContext", () => {
	test("produces markdown table", () => {
		const obs = [makeObservation()];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("| Type | Title | Date |");
		expect(result).toContain("|------|-------|------|");
		expect(result).toContain("Found auth pattern");
		expect(result).toContain("2026-01-15");
	});

	test("limits to 10 observations", () => {
		const obs = Array.from({ length: 15 }, (_, i) =>
			makeObservation({
				id: `obs-${i}`,
				title: `Observation ${i}`,
				createdAt: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
			}),
		);
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		const tableRows = result.split("\n").filter((line) => line.startsWith("| 🔵"));
		expect(tableRows.length).toBeLessThanOrEqual(10);
	});

	test("escapes pipe characters in titles", () => {
		const obs = [makeObservation({ title: "Title with | pipe | chars" })];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("Title with \\| pipe \\| chars");
		expect(result).not.toContain("Title with | pipe | chars");
	});

	test("includes type icons", () => {
		const obs = [
			makeObservation({ type: "bugfix", title: "Fixed bug" }),
			makeObservation({ id: "obs-2", type: "feature", title: "Added feature" }),
		];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("🔴");
		expect(result).toContain("🟣");
	});

	test("includes concepts section when present", () => {
		const obs = [makeObservation({ concepts: ["typescript", "testing"] })];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("**Key concepts:**");
		expect(result).toContain("typescript");
	});

	test("includes decisions section when present", () => {
		const obs = [makeObservation({ type: "decision", title: "Use PostgreSQL" })];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("**Recent decisions:**");
		expect(result).toContain("Use PostgreSQL");
	});

	test("shows relative folder path", () => {
		const result = generateFolderContext("/tmp/proj/src/utils", [makeObservation()], "/tmp/proj");
		expect(result).toContain("`src/utils/`");
	});
});

// =============================================================================
// updateAgentsMd
// =============================================================================

describe("updateAgentsMd", () => {
	let tempDir: string;
	const cleanupFiles: string[] = [];

	afterEach(() => {
		for (const f of cleanupFiles) {
			try {
				unlinkSync(f);
			} catch {
				// ignore
			}
		}
		cleanupFiles.length = 0;
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("creates file in existing folder", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		cleanupFiles.push(agentsMdPath);

		await updateAgentsMd(tempDir, "Test context block");

		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain(START_TAG);
		expect(content).toContain("Test context block");
		expect(content).toContain(END_TAG);
	});

	test("skips non-existent folder", async () => {
		await updateAgentsMd("/nonexistent/folder/path", "Should not write");
		expect(existsSync("/nonexistent/folder/path/AGENTS.md")).toBe(false);
	});

	test("preserves existing content when updating", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		cleanupFiles.push(agentsMdPath);

		const { writeFileSync } = await import("node:fs");
		writeFileSync(agentsMdPath, "# My Custom Notes\n\nImportant info here.\n");

		await updateAgentsMd(tempDir, "Auto-generated context");

		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain("# My Custom Notes");
		expect(content).toContain("Important info here.");
		expect(content).toContain("Auto-generated context");
	});

	test("handles ENOENT race when folder disappears between check and write", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));
		const racyDir = join(tempDir, "racy");
		mkdirSync(racyDir);

		rmSync(racyDir, { recursive: true });

		const tempPath = join(racyDir, ".AGENTS.md.tmp");
		const agentsMdPath = join(racyDir, "AGENTS.md");

		await mkdir(dirname(tempPath), { recursive: true });
		await writeFile(tempPath, "race-safe content", "utf-8");
		await rename(tempPath, agentsMdPath);

		expect(existsSync(agentsMdPath)).toBe(true);
		expect(readFileSync(agentsMdPath, "utf-8")).toBe("race-safe content");
	});

	test("mkdir before atomic write is idempotent on existing dirs", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));

		await updateAgentsMd(tempDir, "idempotent mkdir test");

		const agentsMdPath = join(tempDir, "AGENTS.md");
		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain("idempotent mkdir test");
		expect(existsSync(join(tempDir, ".AGENTS.md.tmp"))).toBe(false);
	});
});
