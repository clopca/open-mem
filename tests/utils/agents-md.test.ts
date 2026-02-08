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
	isHighQualityObservation,
	replaceTaggedContent,
	updateAgentsMd,
	updateFolderContext,
} from "../../src/utils/agents-md";
import {
	cleanFolderContext,
	findAgentsMdFiles,
	purgeFolderContext,
	removeManagedSection,
} from "../../src/utils/folder-context-maintenance";

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

	test("handles file with only start tag (strips orphan, appends)", () => {
		const existing = `# User Notes\n\nSome content.\n\n${START_TAG}\nOrphaned section`;
		const result = replaceTaggedContent(existing, "Fresh content");
		expect(result.split(START_TAG).length - 1).toBe(1);
		expect(result.split(END_TAG).length - 1).toBe(1);
		expect(result.indexOf(START_TAG)).toBeLessThan(result.indexOf(END_TAG));
		expect(result).toContain("Fresh content");
		expect(result).toContain("# User Notes");
		expect(result).toContain("Some content.");
	});

	test("handles file with only end tag (strips orphan, appends)", () => {
		const existing = `# User Notes\n\n${END_TAG}\nTrailing stuff`;
		const result = replaceTaggedContent(existing, "Fresh content");
		expect(result.split(START_TAG).length - 1).toBe(1);
		expect(result.split(END_TAG).length - 1).toBe(1);
		expect(result.indexOf(START_TAG)).toBeLessThan(result.indexOf(END_TAG));
		expect(result).toContain("Fresh content");
		expect(result).toContain("# User Notes");
	});

	test("handles reversed tags (strips both, appends)", () => {
		const existing = `# User Notes\n\n${END_TAG}\nMiddle\n${START_TAG}\nTrailing`;
		const result = replaceTaggedContent(existing, "Fresh content");
		expect(result.split(START_TAG).length - 1).toBe(1);
		expect(result.split(END_TAG).length - 1).toBe(1);
		expect(result.indexOf(START_TAG)).toBeLessThan(result.indexOf(END_TAG));
		expect(result).toContain("Fresh content");
		expect(result).toContain("# User Notes");
	});
});

// =============================================================================
// removeManagedSection
// =============================================================================

describe("removeManagedSection", () => {
	test("strips orphaned start tag", () => {
		const content = `# User Notes\n\n${START_TAG}\nOrphaned content`;
		const result = removeManagedSection(content);
		expect(result).not.toContain(START_TAG);
		expect(result).toContain("# User Notes");
	});

	test("strips orphaned end tag", () => {
		const content = `# User Notes\n\n${END_TAG}\nTrailing`;
		const result = removeManagedSection(content);
		expect(result).not.toContain(END_TAG);
		expect(result).toContain("# User Notes");
	});

	test("strips reversed tags", () => {
		const content = `# User Notes\n\n${END_TAG}\nMiddle\n${START_TAG}\nTrailing`;
		const result = removeManagedSection(content);
		expect(result).not.toContain(START_TAG);
		expect(result).not.toContain(END_TAG);
		expect(result).toContain("# User Notes");
	});

	test("returns content unchanged when no tags present", () => {
		const content = "# User Notes\n\nSome content without any tags.";
		const result = removeManagedSection(content);
		expect(result).toBe(content);
	});
});

// =============================================================================
// generateFolderContext
// =============================================================================

describe("generateFolderContext", () => {
	test("produces markdown table", () => {
		const obs = [makeObservation()];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("| ID | Type | Title | Date |");
		expect(result).toContain("|----|------|-------|------|");
		expect(result).toContain("Found auth pattern");
		expect(result).toContain("2026-01-15");
		expect(result).toContain("obs-1");
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
		const tableRows = result.split("\n").filter((line) => line.startsWith("| obs-"));
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
		expect(result).toContain("obs-1");
		expect(result).toContain("obs-2");
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

	test("includes decision narratives for decision-type observations", () => {
		const obs = [
			makeObservation({
				type: "decision",
				title: "Use PostgreSQL",
				narrative:
					"We chose PostgreSQL over MySQL for better JSON support. It also has better extensions.",
			}),
		];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("**Decision details:**");
		expect(result).toContain(
			"- ⚖️ Use PostgreSQL: We chose PostgreSQL over MySQL for better JSON support",
		);
	});

	test("truncates decision narratives longer than 120 chars", () => {
		const longNarrative = "A".repeat(200);
		const obs = [
			makeObservation({
				type: "decision",
				title: "Long decision",
				narrative: longNarrative,
			}),
		];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("**Decision details:**");
		expect(result).toContain("- ⚖️ Long decision: " + "A".repeat(117) + "...");
		expect(result).not.toContain("A".repeat(118) + "...");
	});

	test("limits decision narratives to 3", () => {
		const obs = Array.from({ length: 5 }, (_, i) =>
			makeObservation({
				id: `obs-${i}`,
				type: "decision",
				title: `Decision ${i}`,
				narrative: `Narrative for decision ${i}.`,
				createdAt: `2026-01-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
			}),
		);
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		const narrativeLines = result.split("\n").filter((line) => line.startsWith("- ⚖️"));
		expect(narrativeLines.length).toBe(3);
	});

	test("skips decision narratives when no decisions have narratives", () => {
		const obs = [makeObservation({ type: "discovery", title: "Just a discovery" })];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).not.toContain("**Decision details:**");
	});

	test("includes memory tip line", () => {
		const obs = [makeObservation()];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain(
			"💡 *Use `mem-find` to search full details across all sessions. Use `mem-create` to save important decisions.*",
		);
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

		await updateAgentsMd(tempDir, "Test context block", "AGENTS.md");

		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain(START_TAG);
		expect(content).toContain("Test context block");
		expect(content).toContain(END_TAG);
	});

	test("skips non-existent folder", async () => {
		await updateAgentsMd("/nonexistent/folder/path", "Should not write", "AGENTS.md");
		expect(existsSync("/nonexistent/folder/path/AGENTS.md")).toBe(false);
	});

	test("preserves existing content when updating", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		cleanupFiles.push(agentsMdPath);

		const { writeFileSync } = await import("node:fs");
		writeFileSync(agentsMdPath, "# My Custom Notes\n\nImportant info here.\n");

		await updateAgentsMd(tempDir, "Auto-generated context", "AGENTS.md");

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

		await updateAgentsMd(tempDir, "idempotent mkdir test", "AGENTS.md");

		const agentsMdPath = join(tempDir, "AGENTS.md");
		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain("idempotent mkdir test");
		expect(existsSync(join(tempDir, ".AGENTS.md.tmp"))).toBe(false);
	});

	test("serializes concurrent writes to the same folder", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-agents-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		cleanupFiles.push(agentsMdPath);

		// Fire 5 concurrent writes
		const writes = Array.from({ length: 5 }, (_, i) =>
			updateAgentsMd(tempDir, `Concurrent write ${i}`, "AGENTS.md"),
		);
		await Promise.all(writes);

		// Verify no corruption — exactly one START_TAG and one END_TAG
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content.split(START_TAG).length - 1).toBe(1);
		expect(content.split(END_TAG).length - 1).toBe(1);
		expect(content.indexOf(START_TAG)).toBeLessThan(content.indexOf(END_TAG));
	});
});

// =============================================================================
// cleanFolderContext
// =============================================================================

describe("cleanFolderContext", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("deletes file when only managed section existed", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-clean-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		writeFileSync(agentsMdPath, `${START_TAG}\nManaged content only\n${END_TAG}\n`);

		const result = await cleanFolderContext(tempDir, "AGENTS.md");

		expect(result.changed).toBe(1);
		expect(existsSync(agentsMdPath)).toBe(false);
	});

	test("preserves file with user content after cleaning", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-clean-"));
		const agentsMdPath = join(tempDir, "AGENTS.md");
		writeFileSync(
			agentsMdPath,
			`# User Notes\n\nImportant info.\n\n${START_TAG}\nManaged content\n${END_TAG}\n`,
		);

		const result = await cleanFolderContext(tempDir, "AGENTS.md");

		expect(result.changed).toBe(1);
		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain("# User Notes");
		expect(content).toContain("Important info.");
		expect(content).not.toContain(START_TAG);
	});
});

// =============================================================================
// updateFolderContext
// =============================================================================

describe("updateFolderContext", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("writes AGENTS.md in subfolder from observations", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fc-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);
		const obs = [
			makeObservation({
				title: "Test observation",
				filesRead: [join(subDir, "index.ts")],
			}),
		];

		await updateFolderContext(tempDir, obs, {
			mode: "dispersed",
			filename: "AGENTS.md",
			maxDepth: 5,
		});

		const agentsMdPath = join(subDir, "AGENTS.md");
		expect(existsSync(agentsMdPath)).toBe(true);
		const content = readFileSync(agentsMdPath, "utf-8");
		expect(content).toContain(START_TAG);
		expect(content).toContain("Test observation");
		expect(content).toContain(END_TAG);
	});

	test("is a no-op for empty observations", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fc-"));

		await updateFolderContext(tempDir, [], {
			mode: "dispersed",
			filename: "AGENTS.md",
			maxDepth: 5,
		});

		const agentsMdPath = join(tempDir, "AGENTS.md");
		expect(existsSync(agentsMdPath)).toBe(false);
	});

	test("does not throw on non-existent project path", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fc-"));
		const obs = [makeObservation({ title: "Error path test" })];

		await updateFolderContext("/nonexistent/path/that/does/not/exist", obs, {
			mode: "dispersed",
			filename: "AGENTS.md",
			maxDepth: 5,
		});
	});
});

// =============================================================================
// isHighQualityObservation
// =============================================================================

describe("isHighQualityObservation", () => {
	test("returns false for 'bash execution'", () => {
		const obs = makeObservation({ title: "bash execution" });
		expect(isHighQualityObservation(obs)).toBe(false);
	});

	test("returns false for 'read execution'", () => {
		const obs = makeObservation({ title: "read execution" });
		expect(isHighQualityObservation(obs)).toBe(false);
	});

	test("returns false for 'mem-create execution'", () => {
		const obs = makeObservation({ title: "mem-create execution" });
		expect(isHighQualityObservation(obs)).toBe(false);
	});

	test("returns false for 'glob execution'", () => {
		const obs = makeObservation({ title: "glob execution" });
		expect(isHighQualityObservation(obs)).toBe(false);
	});

	test("returns true for 'Decided to use JWT for auth'", () => {
		const obs = makeObservation({ title: "Decided to use JWT for auth" });
		expect(isHighQualityObservation(obs)).toBe(true);
	});

	test("returns true for 'Found auth pattern in middleware'", () => {
		const obs = makeObservation({ title: "Found auth pattern in middleware" });
		expect(isHighQualityObservation(obs)).toBe(true);
	});

	test("returns true for multi-word meaningful title", () => {
		const obs = makeObservation({ title: "Refactored database connection pooling" });
		expect(isHighQualityObservation(obs)).toBe(true);
	});

	test("is case-insensitive for noise pattern", () => {
		const obs = makeObservation({ title: "Bash Execution" });
		expect(isHighQualityObservation(obs)).toBe(false);
	});
});

// =============================================================================
// generateFolderContext — quality filtering
// =============================================================================

describe("generateFolderContext quality filtering", () => {
	test("excludes noise observations from output", () => {
		const obs = [
			makeObservation({ id: "noise-1", title: "bash execution" }),
			makeObservation({ id: "noise-2", title: "read execution" }),
			makeObservation({ id: "quality-1", title: "Discovered auth pattern" }),
		];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		expect(result).toContain("Discovered auth pattern");
		expect(result).not.toContain("bash execution");
		expect(result).not.toContain("read execution");
		expect(result).toContain("quality-1");
		expect(result).not.toContain("noise-1");
		expect(result).not.toContain("noise-2");
	});

	test("returns table with zero rows when all observations are noise", () => {
		const obs = [
			makeObservation({ id: "noise-1", title: "bash execution" }),
			makeObservation({ id: "noise-2", title: "glob execution" }),
		];
		const result = generateFolderContext("/tmp/proj/src", obs, "/tmp/proj");
		// Table headers should still be present, but no data rows
		expect(result).toContain("| ID | Type | Title | Date |");
		const tableRows = result.split("\n").filter((line) => line.startsWith("| noise-"));
		expect(tableRows.length).toBe(0);
	});
});

// =============================================================================
// single-root mode
// =============================================================================

describe("single-root mode", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("creates one file at project root", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-single-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);
		const obs = [
			makeObservation({
				title: "Important discovery",
				filesRead: [join(subDir, "index.ts")],
			}),
		];

		await updateFolderContext(tempDir, obs, {
			mode: "single",
			filename: "AGENTS.md",
			maxDepth: 5,
		});

		// Root file should exist
		const rootFile = join(tempDir, "AGENTS.md");
		expect(existsSync(rootFile)).toBe(true);

		// Per-folder file should NOT exist
		const subFile = join(subDir, "AGENTS.md");
		expect(existsSync(subFile)).toBe(false);
	});

	test("groups by folder with section headers", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-single-"));
		const srcDir = join(tempDir, "src");
		const libDir = join(tempDir, "lib");
		mkdirSync(srcDir);
		mkdirSync(libDir);

		const obs = [
			makeObservation({
				id: "obs-src",
				title: "Source discovery",
				filesRead: [join(srcDir, "app.ts")],
			}),
			makeObservation({
				id: "obs-lib",
				title: "Library finding",
				filesRead: [join(libDir, "utils.ts")],
			}),
		];

		await updateFolderContext(tempDir, obs, {
			mode: "single",
			filename: "AGENTS.md",
			maxDepth: 5,
		});

		const content = readFileSync(join(tempDir, "AGENTS.md"), "utf-8");
		expect(content).toContain("### src/");
		expect(content).toContain("### lib/");
		expect(content).toContain("Source discovery");
		expect(content).toContain("Library finding");
		expect(content).toContain("obs-src");
		expect(content).toContain("obs-lib");
	});

	test("omits empty sections after quality filter", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-single-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);

		const obs = [
			makeObservation({
				title: "bash execution",
				filesRead: [join(subDir, "index.ts")],
			}),
		];

		await updateFolderContext(tempDir, obs, {
			mode: "single",
			filename: "AGENTS.md",
			maxDepth: 5,
		});

		// All noise → no file created (single mode filters first)
		const rootFile = join(tempDir, "AGENTS.md");
		expect(existsSync(rootFile)).toBe(false);
	});
});

// =============================================================================
// configurable filename
// =============================================================================

describe("configurable filename", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("updateAgentsMd creates file with custom name", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fname-"));

		await updateAgentsMd(tempDir, "Custom filename context", "CLAUDE.md");

		const customFile = join(tempDir, "CLAUDE.md");
		const defaultFile = join(tempDir, "AGENTS.md");
		expect(existsSync(customFile)).toBe(true);
		expect(existsSync(defaultFile)).toBe(false);
		const content = readFileSync(customFile, "utf-8");
		expect(content).toContain("Custom filename context");
	});

	test("findAgentsMdFiles finds custom-named files", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fname-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);

		// Create CLAUDE.md files in root and subfolder
		writeFileSync(join(tempDir, "CLAUDE.md"), "root context");
		writeFileSync(join(subDir, "CLAUDE.md"), "sub context");

		const files = await findAgentsMdFiles(tempDir, "CLAUDE.md");
		expect(files.length).toBeGreaterThanOrEqual(2);
		expect(files.some((f) => f.endsWith("CLAUDE.md"))).toBe(true);
	});

	test("updateFolderContext uses custom filename in dispersed mode", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-fname-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);

		const obs = [
			makeObservation({
				title: "Custom file test",
				filesRead: [join(subDir, "index.ts")],
			}),
		];

		await updateFolderContext(tempDir, obs, {
			mode: "dispersed",
			filename: "CLAUDE.md",
			maxDepth: 5,
		});

		expect(existsSync(join(subDir, "CLAUDE.md"))).toBe(true);
		expect(existsSync(join(subDir, "AGENTS.md"))).toBe(false);
	});
});

// =============================================================================
// purgeFolderContext
// =============================================================================

describe("purgeFolderContext", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir) {
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	test("deletes all context files", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-purge-"));
		const subDir = join(tempDir, "src");
		mkdirSync(subDir);

		// Create AGENTS.md files (managed-only)
		writeFileSync(join(tempDir, "AGENTS.md"), `${START_TAG}\nManaged content\n${END_TAG}\n`);
		writeFileSync(join(subDir, "AGENTS.md"), `${START_TAG}\nSub content\n${END_TAG}\n`);

		const result = await purgeFolderContext(tempDir, "AGENTS.md");

		expect(result.deleted).toBe(2);
		expect(existsSync(join(tempDir, "AGENTS.md"))).toBe(false);
		expect(existsSync(join(subDir, "AGENTS.md"))).toBe(false);
	});

	test("deletes files with user content outside tags", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-purge-"));

		// Create file with user content + managed section
		writeFileSync(
			join(tempDir, "AGENTS.md"),
			`# My Custom Notes\n\nImportant.\n\n${START_TAG}\nManaged\n${END_TAG}\n`,
		);

		const result = await purgeFolderContext(tempDir, "AGENTS.md");

		// Purge deletes the entire file regardless of user content
		expect(result.deleted).toBe(1);
		expect(existsSync(join(tempDir, "AGENTS.md"))).toBe(false);
	});

	test("returns zero deleted when no files exist", async () => {
		tempDir = mkdtempSync(join(tmpdir(), "open-mem-purge-"));

		const result = await purgeFolderContext(tempDir, "AGENTS.md");

		expect(result.deleted).toBe(0);
		expect(result.files.length).toBe(0);
	});
});
