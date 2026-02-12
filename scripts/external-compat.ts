import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

export type ClientName = "claude-code" | "cursor";

export interface ScenarioResult {
	id: string;
	name: string;
	passed: boolean;
	durationMs: number;
	failureCode?: string;
	details?: string;
	metrics?: {
		p95Ms?: number;
		samples?: number;
	};
}

export interface ExternalCompatReport {
	schemaVersion: "1.0.0";
	generatedAt: string;
	gitSha: string;
	environment: {
		os: string;
		arch: string;
		bunVersion: string;
		runner: string;
	};
	policy: {
		freshnessDays: number;
		versionScope: "latest-stable-only";
		verificationScope: string;
	};
	clients: Array<{
		name: ClientName;
		transport: "stdio";
		protocolVersion: "2024-11-05";
		status: "supported" | "expected-supported" | "failed";
		version: {
			detected: string;
			source: "env" | "manual" | "unknown";
		};
		requiredScenarios: ScenarioResult[];
		knownLimitations: string[];
		artifacts: {
			transcriptsDir: string;
			logFile: string;
		};
	}>;
	summary: {
		scenarioCount: number;
		failedScenarios: number;
		failureRate: number;
		allRequiredPassed: boolean;
		mcpToolCallP95Ms: number;
		workerEventIngestP95Ms: number;
	};
	slo: {
		mcpToolCallP95TargetMs: 250;
		workerEventIngestP95TargetMs: 100;
		externalFailureRateTarget: 0.01;
		met: boolean;
	};
	failureTaxonomy: Array<{
		code:
			| "CLIENT_PROTOCOL_DRIFT"
			| "WORKER_BRIDGE_REGRESSION"
			| "ENVIRONMENT_DEPENDENCY"
			| "NON_DETERMINISTIC_OUTPUT";
		description: string;
		remediation: string;
	}>;
}

export interface MatrixClientSummary {
	name: ClientName;
	version: string;
	status: "supported" | "expected-supported" | "failed";
	verifiedOn: string;
	knownLimitations: string[];
	notes: string;
}

export function percentile95(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
	return Number((sorted[index] ?? 0).toFixed(2));
}

export function classifyFailure(code?: string): ExternalCompatReport["failureTaxonomy"][number]["code"] {
	if (!code) return "NON_DETERMINISTIC_OUTPUT";
	if (code.startsWith("MCP_") || code.startsWith("ASSERT_")) return "CLIENT_PROTOCOL_DRIFT";
	if (code.startsWith("WORKER_") || code.startsWith("BRIDGE_")) return "WORKER_BRIDGE_REGRESSION";
	if (code.startsWith("ENV_")) return "ENVIRONMENT_DEPENDENCY";
	return "NON_DETERMINISTIC_OUTPUT";
}

export function getFailureTaxonomy(): ExternalCompatReport["failureTaxonomy"] {
	return [
		{
			code: "CLIENT_PROTOCOL_DRIFT",
			description: "Lifecycle or JSON-RPC behavior mismatch with claimed protocol contract.",
			remediation:
				"Patch MCP compatibility handling, add/update transcript fixtures, rerun verification.",
		},
		{
			code: "WORKER_BRIDGE_REGRESSION",
			description: "Platform worker bridge command/transport behavior mismatch.",
			remediation:
				"Patch platform worker bridge implementation, rerun smoke checks, add targeted regression tests.",
		},
		{
			code: "ENVIRONMENT_DEPENDENCY",
			description: "Client binary/version unavailable or runtime dependency missing on runner.",
			remediation:
				"Fix runner provisioning/install scripts and pin verified client setup before re-running.",
		},
		{
			code: "NON_DETERMINISTIC_OUTPUT",
			description: "Unstable output shape prevents deterministic verification.",
			remediation:
				"Normalize volatile fields in harness output and tighten fixture assertions to stable keys.",
		},
	];
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
	const raw = await readFile(filePath, "utf8");
	return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeTextFile(filePath: string, value: string): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, value, "utf8");
}

export function assertExists(path: string, label: string): void {
	if (!existsSync(path)) throw new Error(`ENV_MISSING_${label}: ${path}`);
}

export function rel(base: string, target: string): string {
	return relative(base, target) || ".";
}

export function toDate(value: string): Date {
	const d = new Date(value);
	if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
	return d;
}

export function validateExternalCompatReport(report: ExternalCompatReport): string[] {
	const errors: string[] = [];
	if (report.schemaVersion !== "1.0.0") errors.push("schemaVersion must be 1.0.0");
	if (!report.generatedAt) errors.push("generatedAt is required");
	if (!report.gitSha) errors.push("gitSha is required");
	if (report.clients.length < 2) errors.push("clients must include claude-code and cursor");
	const names = new Set(report.clients.map((c) => c.name));
	if (!names.has("claude-code")) errors.push("missing claude-code entry");
	if (!names.has("cursor")) errors.push("missing cursor entry");
	for (const client of report.clients) {
		if (client.requiredScenarios.length === 0) errors.push(`${client.name}: missing requiredScenarios`);
		if (!client.artifacts.logFile) errors.push(`${client.name}: missing logFile`);
		if (!client.artifacts.transcriptsDir) errors.push(`${client.name}: missing transcriptsDir`);
	}
	if (report.policy.freshnessDays <= 0) errors.push("freshnessDays must be > 0");
	return errors;
}

export function summarizeMatrixClients(report: ExternalCompatReport): MatrixClientSummary[] {
	return report.clients.map((client) => {
		const passed = client.requiredScenarios.filter((s) => s.passed).length;
		const total = client.requiredScenarios.length;
		return {
			name: client.name,
			version: client.version.detected,
			status: client.status,
			verifiedOn: report.generatedAt,
			knownLimitations: client.knownLimitations,
			notes: `${passed}/${total} required scenarios passed`,
		};
	});
}
