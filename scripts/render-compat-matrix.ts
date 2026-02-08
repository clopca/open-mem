#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import {
	readJsonFile,
	summarizeMatrixClients,
	type ExternalCompatReport,
} from "./external-compat";

const START = "<!-- external-compat:generated:start -->";
const END = "<!-- external-compat:generated:end -->";

function formatStatus(status: string): string {
	switch (status) {
		case "supported":
			return "Supported";
		case "failed":
			return "Failed";
		default:
			return "Expected Supported";
	}
}

function renderGeneratedBlock(report: ExternalCompatReport): string {
	const rows = summarizeMatrixClients(report)
		.map((client) => {
			const label = client.name === "claude-code" ? "Claude Code MCP integration" : "Cursor MCP integration";
			const limitations = client.knownLimitations.length ? client.knownLimitations.join("; ") : "None.";
			return `| ${label} | stdio | ${report.clients.find((c) => c.name === client.name)?.protocolVersion ?? "2024-11-05"} | ${client.version} | ${formatStatus(client.status)} | ${client.verifiedOn} | ${client.notes} | ${limitations} |`;
		})
		.join("\n");

	return [
		START,
		"| Client | Transport | Protocol Version | Client Version | Status | Verified On | Notes | Known Limitations |",
		"|---|---|---:|---|---|---|---|---|",
		"| OpenCode MCP client | stdio | 2024-11-05 | n/a | Supported | Internal regression suite | Full lifecycle and transcript harness coverage. | None. |",
		rows,
		END,
	].join("\n");
}

export async function renderCompatMatrix(options?: {
	reportPath?: string;
	matrixPath?: string;
}): Promise<string> {
	const reportPath = options?.reportPath ?? "docs/compatibility/external-compat-latest.json";
	const matrixPath = options?.matrixPath ?? "docs/mcp-compatibility-matrix.md";

	const report = await readJsonFile<ExternalCompatReport>(reportPath);
	const block = renderGeneratedBlock(report);
	const current = await readFile(matrixPath, "utf8");

	const hasMarkers = current.includes(START) && current.includes(END);
	let next: string;
	if (hasMarkers) {
		next = current.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
	} else {
		next = `${current.trim()}\n\n${block}\n`;
	}
	await writeFile(matrixPath, next, "utf8");
	return block;
}

async function main() {
	const args = Bun.argv.slice(2);
	const reportPath = args.includes("--report")
		? args[args.indexOf("--report") + 1]
		: undefined;
	const matrixPath = args.includes("--matrix")
		? args[args.indexOf("--matrix") + 1]
		: undefined;

	await renderCompatMatrix({ reportPath, matrixPath });
	console.log("[render-compat-matrix] updated", matrixPath ?? "docs/mcp-compatibility-matrix.md");
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[render-compat-matrix] fatal", error);
		process.exit(1);
	});
}
