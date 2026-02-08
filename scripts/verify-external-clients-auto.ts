#!/usr/bin/env bun

import { detectClientVersions } from "./detect-client-versions";
import { renderCompatMatrix } from "./render-compat-matrix";
import { verifyExternalClients } from "./verify-external-clients";

function parseArgs() {
	const args = Bun.argv.slice(2);
	const pick = (flag: string, fallback: string) => {
		const index = args.indexOf(flag);
		return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
	};
	return {
		artifactsDir: pick("--artifacts-dir", "artifacts/external-compat"),
		project: pick("--project", process.cwd()),
	};
}

async function main() {
	const args = parseArgs();
	const detected = detectClientVersions();

	process.env.OPEN_MEM_CLAUDE_CODE_VERSION = detected.claudeCodeVersion;
	process.env.OPEN_MEM_CURSOR_VERSION = detected.cursorVersion;

	const report = await verifyExternalClients({
		artifactsDir: args.artifactsDir,
		project: args.project,
		runner: process.env.GITHUB_ACTIONS === "true" ? "github-actions-self-hosted-macos" : "local",
	});

	await renderCompatMatrix({
		reportPath: "docs/compatibility/external-compat-latest.json",
		matrixPath: "docs/mcp-compatibility-matrix.md",
	});

	console.log("[verify-external-clients-auto] done", {
		detected,
		statuses: report.clients.map((c) => ({ name: c.name, status: c.status, version: c.version.detected })),
	});
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[verify-external-clients-auto] fatal", error);
		process.exit(1);
	});
}
