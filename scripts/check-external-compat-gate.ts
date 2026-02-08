#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import {
	readJsonFile,
	toDate,
	validateExternalCompatReport,
	type ExternalCompatReport,
} from "./external-compat";

function parseArgs() {
	const args = Bun.argv.slice(2);
	const pick = (flag: string, fallback: string) => {
		const idx = args.indexOf(flag);
		return idx >= 0 ? (args[idx + 1] ?? fallback) : fallback;
	};
	return {
		reportPath: pick("--report", "docs/compatibility/external-compat-latest.json"),
		matrixPath: pick("--matrix", "docs/mcp-compatibility-matrix.md"),
		freshnessDays: Number(pick("--freshness-days", "7")),
	};
}

export async function checkExternalCompatGate(options?: {
	reportPath?: string;
	matrixPath?: string;
	freshnessDays?: number;
}): Promise<{ ok: boolean; errors: string[] }> {
	const reportPath = options?.reportPath ?? "docs/compatibility/external-compat-latest.json";
	const matrixPath = options?.matrixPath ?? "docs/mcp-compatibility-matrix.md";
	const freshnessDays = options?.freshnessDays ?? 7;
	const errors: string[] = [];

	const report = await readJsonFile<ExternalCompatReport>(reportPath);
	const reportValidationErrors = validateExternalCompatReport(report);
	errors.push(...reportValidationErrors.map((e) => `REPORT_SCHEMA:${e}`));

	const now = new Date();
	const generatedAt = toDate(report.generatedAt);
	const ageMs = now.getTime() - generatedAt.getTime();
	if (ageMs > freshnessDays * 24 * 60 * 60 * 1000) {
		errors.push(`STALE_REPORT: generatedAt=${report.generatedAt} freshnessDays=${freshnessDays}`);
	}

	for (const client of report.clients) {
		if (client.status !== "supported") {
			errors.push(`CLIENT_NOT_SUPPORTED:${client.name}:${client.status}`);
		}
		if (client.version.detected === "unknown") {
			errors.push(`CLIENT_VERSION_UNKNOWN:${client.name}`);
		}
		for (const scenario of client.requiredScenarios) {
			if (!scenario.passed) {
				errors.push(`SCENARIO_FAILED:${client.name}:${scenario.id}:${scenario.failureCode ?? "unknown"}`);
			}
		}
	}

	const matrix = await readFile(matrixPath, "utf8");
	for (const client of report.clients) {
		const label = client.name === "claude-code" ? "Claude Code MCP integration" : "Cursor MCP integration";
		const expectedStatus =
			client.status === "supported"
				? "Supported"
				: client.status === "failed"
					? "Failed"
					: "Expected Supported";
		const rowMustContain = `${label} | stdio | 2024-11-05 | ${client.version.detected} | ${expectedStatus}`;
		if (!matrix.includes(rowMustContain)) {
			errors.push(`MATRIX_MISMATCH:${client.name}: expected row fragment '${rowMustContain}'`);
		}
	}

	return { ok: errors.length === 0, errors };
}

async function main() {
	const args = parseArgs();
	const result = await checkExternalCompatGate(args);
	if (!result.ok) {
		console.error("[check-external-compat-gate] failed");
		for (const error of result.errors) console.error(` - ${error}`);
		process.exit(1);
	}
	console.log("[check-external-compat-gate] passed");
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[check-external-compat-gate] fatal", error);
		process.exit(1);
	});
}
