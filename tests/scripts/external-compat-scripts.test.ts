import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	validateExternalCompatReport,
	type ExternalCompatReport,
} from "../../scripts/external-compat";
import { renderCompatMatrix } from "../../scripts/render-compat-matrix";
import { checkExternalCompatGate } from "../../scripts/check-external-compat-gate";

function sampleReport(overrides?: Partial<ExternalCompatReport>): ExternalCompatReport {
	const base: ExternalCompatReport = {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		gitSha: "abc1234",
		environment: {
			os: "darwin",
			arch: "arm64",
			bunVersion: "1.3.0",
			runner: "test",
		},
		policy: {
			freshnessDays: 7,
			versionScope: "latest-stable-only",
			verificationScope: "macOS self-hosted verification only",
		},
		clients: [
			{
				name: "claude-code",
				transport: "stdio",
				protocolVersion: "2024-11-05",
				status: "supported",
				version: { detected: "1.0.0", source: "env" },
				requiredScenarios: [
					{ id: "s1", name: "scenario", passed: true, durationMs: 10 },
				],
				knownLimitations: ["None."],
				artifacts: { transcriptsDir: "transcripts/claude-code", logFile: "logs/claude-code.log" },
			},
			{
				name: "cursor",
				transport: "stdio",
				protocolVersion: "2024-11-05",
				status: "supported",
				version: { detected: "2.0.0", source: "env" },
				requiredScenarios: [
					{ id: "s1", name: "scenario", passed: true, durationMs: 10 },
				],
				knownLimitations: ["None."],
				artifacts: { transcriptsDir: "transcripts/cursor", logFile: "logs/cursor.log" },
			},
		],
		summary: {
			scenarioCount: 2,
			failedScenarios: 0,
			failureRate: 0,
			allRequiredPassed: true,
			mcpToolCallP95Ms: 10,
			workerEventIngestP95Ms: 5,
		},
		slo: {
			mcpToolCallP95TargetMs: 250,
			workerEventIngestP95TargetMs: 100,
			externalFailureRateTarget: 0.01,
			met: true,
		},
		failureTaxonomy: [
			{ code: "CLIENT_PROTOCOL_DRIFT", description: "d", remediation: "r" },
			{ code: "WORKER_BRIDGE_REGRESSION", description: "d", remediation: "r" },
			{ code: "ENVIRONMENT_DEPENDENCY", description: "d", remediation: "r" },
			{ code: "NON_DETERMINISTIC_OUTPUT", description: "d", remediation: "r" },
		],
	};
	return { ...base, ...overrides };
}

describe("external compatibility scripts", () => {
	test("validateExternalCompatReport passes for well-formed report", () => {
		const errors = validateExternalCompatReport(sampleReport());
		expect(errors).toEqual([]);
	});

	test("renderCompatMatrix deterministically updates generated block", async () => {
		const dir = await mkdtemp(join(tmpdir(), "open-mem-render-matrix-"));
		try {
			const reportPath = join(dir, "report.json");
			const matrixPath = join(dir, "matrix.md");
			await writeFile(reportPath, `${JSON.stringify(sampleReport(), null, 2)}\n`, "utf8");
			await writeFile(
				matrixPath,
				"# Matrix\n\n<!-- external-compat:generated:start -->\nold\n<!-- external-compat:generated:end -->\n",
				"utf8",
			);

			const first = await renderCompatMatrix({ reportPath, matrixPath });
			const second = await renderCompatMatrix({ reportPath, matrixPath });
			expect(first).toEqual(second);

			const content = await readFile(matrixPath, "utf8");
			expect(content).toContain("Claude Code MCP integration");
			expect(content).toContain("Cursor MCP integration");
			expect(content).toContain("| 1.0.0 | Supported |");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("checkExternalCompatGate rejects stale report", async () => {
		const dir = await mkdtemp(join(tmpdir(), "open-mem-gate-"));
		try {
			const oldDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
			const report = sampleReport({ generatedAt: oldDate });
			const reportPath = join(dir, "report.json");
			const matrixPath = join(dir, "matrix.md");
			await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
			await writeFile(
				matrixPath,
				`| Claude Code MCP integration | stdio | 2024-11-05 | ${report.clients[0].version.detected} | Supported |\n| Cursor MCP integration | stdio | 2024-11-05 | ${report.clients[1].version.detected} | Supported |\n`,
				"utf8",
			);

			const result = await checkExternalCompatGate({ reportPath, matrixPath, freshnessDays: 7 });
			expect(result.ok).toBe(false);
			expect(result.errors.some((e) => e.startsWith("STALE_REPORT"))).toBe(true);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
