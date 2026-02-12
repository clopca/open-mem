#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { runWorkerSmoke } from "./smoke-platform-workers";
import {
	assertExists,
	classifyFailure,
	getFailureTaxonomy,
	percentile95,
	readJsonFile,
	rel,
	validateExternalCompatReport,
	writeJsonFile,
	writeTextFile,
	type ClientName,
	type ExternalCompatReport,
} from "./external-compat";

interface MtpAssertion {
	responseId: number;
	contains: string[];
}

interface MtpScenario {
	id: string;
	name: string;
	messages: Array<Record<string, unknown>>;
	assertions: MtpAssertion[];
}

interface MtpFixture {
	client: ClientName;
	protocolVersion: string;
	scenarios: MtpScenario[];
}

function parseArgs() {
	const args = Bun.argv.slice(2);
	const pick = (flag: string, fallback: string) => {
		const index = args.indexOf(flag);
		return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
	};
	return {
		artifactsDir: pick("--artifacts-dir", "artifacts/external-compat"),
		project: pick("--project", process.cwd()),
		runner: process.env.GITHUB_ACTIONS === "true" ? "github-actions-self-hosted-macos" : "local",
	};
}

async function runMcpScenario(
	scenario: MtpScenario,
	projectPath: string,
	client: ClientName,
	artifactsDir: string,
): Promise<{ passed: boolean; durationMs: number; details?: string; failureCode?: string; transcriptLines: string[] }> {
	const input = `${scenario.messages.map((m) => JSON.stringify(m)).join("\n")}\n`;
	const start = performance.now();
	const proc = Bun.spawn(["bun", "run", "dist/mcp.js", "--project", projectPath], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPEN_MEM_COMPRESSION: "false",
			OPEN_MEM_MCP_COMPAT_MODE: "strict",
		},
	});

	proc.stdin.write(input);
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exit = await proc.exited;
	const durationMs = Number((performance.now() - start).toFixed(2));
	if (exit !== 0) {
		return {
			passed: false,
			durationMs,
			failureCode: "MCP_PROCESS_EXIT",
			details: stderr,
			transcriptLines: stdout.split("\n").filter(Boolean),
		};
	}

	const responseLines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	const responses = responseLines.map((line) => {
		try {
			return JSON.parse(line) as Record<string, unknown>;
		} catch {
			return null;
		}
	});

	const malformed = responses.findIndex((value) => value === null);
	if (malformed >= 0) {
		return {
			passed: false,
			durationMs,
			failureCode: "MCP_RESPONSE_NOT_JSON",
			details: `Malformed JSON line index=${malformed}`,
			transcriptLines: responseLines,
		};
	}

	for (const assertion of scenario.assertions) {
		const response = responses.find(
			(item) => item && typeof item.id === "number" && item.id === assertion.responseId,
		) as Record<string, unknown> | undefined;
		if (!response) {
			return {
				passed: false,
				durationMs,
				failureCode: "ASSERT_RESPONSE_MISSING",
				details: `Response id ${assertion.responseId} missing`,
				transcriptLines: responseLines,
			};
		}
		const serialized = JSON.stringify(response);
		for (const token of assertion.contains) {
			if (!serialized.includes(token)) {
				return {
					passed: false,
					durationMs,
					failureCode: "ASSERT_CONTAINS_FAILED",
					details: `Expected token '${token}' in response id=${assertion.responseId}`,
					transcriptLines: responseLines,
				};
			}
		}
	}

	await writeTextFile(
		`${artifactsDir}/transcripts/${client}/${scenario.id}.jsonl`,
		`${scenario.messages
			.map((m) => JSON.stringify({ direction: "request", payload: m }))
			.join("\n")}\n${responseLines
			.map((line) => JSON.stringify({ direction: "response", payload: JSON.parse(line) }))
			.join("\n")}\n`,
	);

	return { passed: true, durationMs, transcriptLines: responseLines };
}

function getClientVersion(client: ClientName): { detected: string; source: "env" | "manual" | "unknown" } {
	const envName = client === "claude-code" ? "OPEN_MEM_CLAUDE_CODE_VERSION" : "OPEN_MEM_CURSOR_VERSION";
	const value = process.env[envName]?.trim();
	if (!value) return { detected: "unknown", source: "unknown" };
	return { detected: value, source: "env" };
}

function statusFromScenarios(
	allPassed: boolean,
	version: { detected: string },
): "supported" | "expected-supported" | "failed" {
	if (!allPassed) return "failed";
	if (version.detected === "unknown") return "expected-supported";
	return "supported";
}

export async function verifyExternalClients(options?: {
	artifactsDir?: string;
	project?: string;
	runner?: string;
}): Promise<ExternalCompatReport> {
	assertExists("dist/mcp.js", "DIST_MCP");
	assertExists("dist/claude-code.js", "DIST_CLAUDE_WORKER");
	assertExists("dist/cursor.js", "DIST_CURSOR_WORKER");

	const artifactsDir = options?.artifactsDir ?? "artifacts/external-compat";
	const project = options?.project ?? process.cwd();
	const runner = options?.runner ?? "local";

	await mkdir(`${artifactsDir}/transcripts`, { recursive: true });
	await mkdir(`${artifactsDir}/logs`, { recursive: true });

	const clientResults: ExternalCompatReport["clients"] = [];
	const toolCallDurations: number[] = [];

	for (const client of ["claude-code", "cursor"] as const) {
		const fixture = await readJsonFile<MtpFixture>(
			`tests/fixtures/external-clients/${client}-mcp.json`,
		);
		const scenarioResults = [] as ExternalCompatReport["clients"][number]["requiredScenarios"];
		const logLines: string[] = [];

		for (const scenario of fixture.scenarios) {
			const result = await runMcpScenario(scenario, project, client, artifactsDir);
			if (scenario.id.includes("tool") || scenario.id.includes("validation")) {
				toolCallDurations.push(result.durationMs);
			}
			scenarioResults.push({
				id: scenario.id,
				name: scenario.name,
				passed: result.passed,
				durationMs: result.durationMs,
				failureCode: result.failureCode,
				details: result.details,
			});
			if (!result.passed) {
				logLines.push(
					`[${scenario.id}] failed code=${result.failureCode ?? "unknown"} details=${result.details ?? "n/a"}`,
				);
			}
		}

		const version = getClientVersion(client);
		const allPassed = scenarioResults.every((s) => s.passed);
		const knownLimitations: string[] = [];
		if (version.detected === "unknown") {
			knownLimitations.push(
				"Client version was not provided via environment; status remains Expected Supported.",
			);
		}
		if (!allPassed) {
			const firstFailure = scenarioResults.find((s) => !s.passed);
			knownLimitations.push(
				`Required scenario failed: ${firstFailure?.id ?? "unknown"} (${firstFailure?.failureCode ?? "n/a"}).`,
			);
		}
		if (knownLimitations.length === 0) {
			knownLimitations.push("None.");
		}

		await writeTextFile(`${artifactsDir}/logs/${client}.log`, `${logLines.join("\n")}\n`);

		clientResults.push({
			name: client,
			transport: "stdio",
			protocolVersion: fixture.protocolVersion as "2024-11-05",
			status: statusFromScenarios(allPassed, version),
			version,
			requiredScenarios: scenarioResults,
			knownLimitations,
			artifacts: {
				transcriptsDir: `transcripts/${client}`,
				logFile: `logs/${client}.log`,
			},
		});
	}

	const smokeResults = await runWorkerSmoke(artifactsDir);
	const workerDurations = smokeResults.map((r) => r.eventP95Ms);
	const failedWorker = smokeResults.filter(
		(r) => !r.stdioPassed || !r.httpPassed || !r.invalidJsonRecoveryPassed,
	);

	for (const failed of failedWorker) {
		const client = clientResults.find((entry) => entry.name === failed.client);
		if (!client) continue;
		client.status = "failed";
		client.requiredScenarios.push({
			id: "worker-bridge-smoke",
			name: "worker stdio/http bridge smoke",
			passed: false,
			durationMs: failed.eventP95Ms,
			failureCode: "WORKER_BRIDGE_SMOKE_FAILED",
			details: failed.errors.join("; "),
			metrics: { p95Ms: failed.eventP95Ms, samples: 2 },
		});
		if (!client.knownLimitations.some((value) => value.includes("worker bridge"))) {
			client.knownLimitations.push("Worker bridge smoke checks failed.");
		}
	}

	const allScenarios = clientResults.flatMap((client) => client.requiredScenarios);
	const failedScenarios = allScenarios.filter((s) => !s.passed).length;
	const failureRate = allScenarios.length === 0 ? 0 : Number((failedScenarios / allScenarios.length).toFixed(4));
	const mcpP95 = percentile95(toolCallDurations);
	const workerP95 = percentile95(workerDurations);
	const allRequiredPassed = failedScenarios === 0;
	const sloMet =
		mcpP95 < 250 &&
		workerP95 < 100 &&
		failureRate < 0.01 &&
		clientResults.every((client) => client.status === "supported");

	const gitShaProcess = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
	const gitSha =
		gitShaProcess.exitCode === 0
			? Buffer.from(gitShaProcess.stdout).toString("utf8").trim()
			: "unknown";

	const report: ExternalCompatReport = {
		schemaVersion: "1.0.0",
		generatedAt: new Date().toISOString(),
		gitSha,
		environment: {
			os: process.platform,
			arch: process.arch,
			bunVersion: Bun.version,
			runner,
		},
		policy: {
			freshnessDays: 7,
			versionScope: "latest-stable-only",
			verificationScope: "macOS self-hosted verification only",
		},
		clients: clientResults,
		summary: {
			scenarioCount: allScenarios.length,
			failedScenarios,
			failureRate,
			allRequiredPassed,
			mcpToolCallP95Ms: mcpP95,
			workerEventIngestP95Ms: workerP95,
		},
		slo: {
			mcpToolCallP95TargetMs: 250,
			workerEventIngestP95TargetMs: 100,
			externalFailureRateTarget: 0.01,
			met: sloMet,
		},
		failureTaxonomy: getFailureTaxonomy(),
	};

	const validationErrors = validateExternalCompatReport(report);
	if (validationErrors.length > 0) {
		throw new Error(`ENV_REPORT_SCHEMA_INVALID: ${validationErrors.join("; ")}`);
	}

	await writeJsonFile(`${artifactsDir}/external-compat-report.json`, report);

	const summaryMd = [
		"# External Compatibility Verification Summary",
		"",
		`- Generated: ${report.generatedAt}`,
		`- Git SHA: ${report.gitSha}`,
		`- Runner: ${report.environment.runner}`,
		`- MCP tool call p95: ${report.summary.mcpToolCallP95Ms}ms (target < 250ms)`,
		`- Worker ingest p95: ${report.summary.workerEventIngestP95Ms}ms (target < 100ms)`,
		`- Failure rate: ${report.summary.failureRate} (target < 0.01)`,
		"",
		"## Client Status",
		...report.clients.map(
			(client) =>
				`- ${client.name}: ${client.status} (version=${client.version.detected}; limitations=${client.knownLimitations.join(" | ")})`,
		),
		"",
		"## Failure Taxonomy",
		...report.failureTaxonomy.map((f) => `- ${f.code}: ${f.description}`),
	].join("\n");
	await writeTextFile(`${artifactsDir}/summary.md`, `${summaryMd}\n`);

	const filesForChecksums = [
		`${artifactsDir}/external-compat-report.json`,
		`${artifactsDir}/summary.md`,
		`${artifactsDir}/worker-smoke.json`,
	];
	const checksums: string[] = [];
	for (const file of filesForChecksums) {
		const content = await readFile(file);
		const digest = createHash("sha256").update(content).digest("hex");
		checksums.push(`${digest}  ${rel(artifactsDir, file)}`);
	}
	await writeTextFile(`${artifactsDir}/checksums.txt`, `${checksums.join("\n")}\n`);

	await writeJsonFile("docs/compatibility/external-compat-latest.json", report);
	const dateName = report.generatedAt.slice(0, 10);
	await writeJsonFile(`docs/compatibility/external-compat-history/${dateName}.json`, report);

	return report;
}

async function main() {
	const args = parseArgs();
	const report = await verifyExternalClients({
		artifactsDir: args.artifactsDir,
		project: args.project,
		runner: args.runner,
	});
	const failedStatuses = report.clients.filter((client) => client.status === "failed");
	if (failedStatuses.length > 0) {
		const mapped = failedStatuses.flatMap((client) =>
			client.requiredScenarios
				.filter((scenario) => !scenario.passed)
				.map((scenario) => classifyFailure(scenario.failureCode)),
		);
		console.error("[verify-external-clients] failed", {
			clients: failedStatuses.map((client) => client.name),
			categories: mapped,
		});
		process.exit(1);
	}
	console.log("[verify-external-clients] completed", {
		generatedAt: report.generatedAt,
		statuses: report.clients.map((client) => ({
			name: client.name,
			status: client.status,
			version: client.version.detected,
		})),
	});
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[verify-external-clients] fatal", error);
		process.exit(1);
	});
}
