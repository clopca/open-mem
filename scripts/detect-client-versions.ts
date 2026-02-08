#!/usr/bin/env bun

import { existsSync } from "node:fs";

export interface DetectionResult {
	claudeCodeVersion: string;
	cursorVersion: string;
	source: {
		claudeCode: string;
		cursor: string;
	};
}

function parseVersion(text: string): string | null {
	const match = text.match(/\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?|\d+\.\d+)\b/);
	return match?.[1] ?? null;
}

function tryCommand(command: string[], source: string): { version: string; source: string } | null {
	const proc = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
	if (proc.exitCode !== 0) return null;
	const out = `${Buffer.from(proc.stdout).toString("utf8")}\n${Buffer.from(proc.stderr).toString("utf8")}`;
	const parsed = parseVersion(out);
	if (!parsed) return null;
	return { version: parsed, source };
}

function detectClaudeCodeVersion(): { version: string; source: string } {
	const probes: Array<{ cmd: string[]; source: string }> = [
		{ cmd: ["claude", "--version"], source: "claude --version" },
		{ cmd: ["claude", "version"], source: "claude version" },
		{ cmd: ["claude-code", "--version"], source: "claude-code --version" },
		{ cmd: ["claude-code", "version"], source: "claude-code version" },
	];
	for (const probe of probes) {
		const found = tryCommand(probe.cmd, probe.source);
		if (found) return found;
	}
	return { version: "unknown", source: "not-detected" };
}

function detectCursorVersion(): { version: string; source: string } {
	const probes: Array<{ cmd: string[]; source: string }> = [
		{ cmd: ["cursor", "--version"], source: "cursor --version" },
		{ cmd: ["cursor", "version"], source: "cursor version" },
		{ cmd: ["cursor-cli", "--version"], source: "cursor-cli --version" },
	];
	for (const probe of probes) {
		const found = tryCommand(probe.cmd, probe.source);
		if (found) return found;
	}

	if (process.platform === "darwin") {
		const appPath = "/Applications/Cursor.app/Contents/Info.plist";
		if (existsSync(appPath)) {
			const plist = tryCommand(
				["defaults", "read", "/Applications/Cursor.app/Contents/Info", "CFBundleShortVersionString"],
				"Cursor.app Info.plist",
			);
			if (plist) return plist;
		}
	}

	return { version: "unknown", source: "not-detected" };
}

export function detectClientVersions(): DetectionResult {
	const claude = detectClaudeCodeVersion();
	const cursor = detectCursorVersion();
	return {
		claudeCodeVersion: claude.version,
		cursorVersion: cursor.version,
		source: {
			claudeCode: claude.source,
			cursor: cursor.source,
		},
	};
}

async function main() {
	const detected = detectClientVersions();
	console.log(JSON.stringify(detected, null, 2));
	console.log(`OPEN_MEM_CLAUDE_CODE_VERSION=${detected.claudeCodeVersion}`);
	console.log(`OPEN_MEM_CURSOR_VERSION=${detected.cursorVersion}`);
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[detect-client-versions] fatal", error);
		process.exit(1);
	});
}
