#!/usr/bin/env bun

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import {
	assertExists,
	percentile95,
	readJsonFile,
	writeJsonFile,
	writeTextFile,
	type ClientName,
} from "./external-compat";

interface WorkerFixture {
	client: ClientName;
	events: unknown[];
}

interface SmokeResult {
	client: ClientName;
	stdioPassed: boolean;
	httpPassed: boolean;
	invalidJsonRecoveryPassed: boolean;
	eventP95Ms: number;
	errors: string[];
}

function parseArgs() {
	const args = Bun.argv.slice(2);
	const artifactsDir = args.includes("--artifacts-dir")
		? args[args.indexOf("--artifacts-dir") + 1]
		: "artifacts/external-compat";
	return { artifactsDir };
}

async function getFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				server.close();
				reject(new Error("Could not resolve free port"));
				return;
			}
			const port = addr.port;
			server.close((err) => {
				if (err) reject(err);
				else resolve(port);
			});
		});
		server.on("error", reject);
	});
}

function workerEntry(client: ClientName): string {
	return client === "claude-code" ? "dist/claude-code.js" : "dist/cursor.js";
}

async function runStdioSmoke(
	client: ClientName,
	projectPath: string,
	fixture: WorkerFixture,
): Promise<{ passed: boolean; invalidJsonRecovery: boolean; p95Ms: number; transcript: string[]; errors: string[] }> {
	const entry = workerEntry(client);
	const proc = Bun.spawn(["bun", "run", entry, "--project", projectPath], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPEN_MEM_COMPRESSION: "false",
			OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
			OPEN_MEM_PLATFORM_CURSOR: "true",
		},
	});

	const inputLines = [
		"not-json",
		JSON.stringify({ command: "health", id: "h1" }),
		...fixture.events.map((event) => JSON.stringify(event)),
		JSON.stringify({ command: "flush", id: "f1" }),
		JSON.stringify({ command: "shutdown", id: "s1" }),
	];

	const durations: number[] = [];
	for (const line of inputLines) {
		const start = performance.now();
		proc.stdin.write(`${line}\n`);
		durations.push(performance.now() - start);
	}
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exit = await proc.exited;
	const responseLines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);

	const errors: string[] = [];
	if (exit !== 0) errors.push(`WORKER_STDIO_EXIT_${exit}:${stderr}`);
	if (!responseLines.some((line) => line.includes("INVALID_JSON"))) {
		errors.push("WORKER_STDIO_INVALID_JSON_NOT_REPORTED");
	}
	if (!responseLines.some((line) => line.includes('"id":"h1"') && line.includes('"ok":true'))) {
		errors.push("WORKER_STDIO_HEALTH_FAILED");
	}
	if (!responseLines.some((line) => line.includes('"id":"f1"') && line.includes('"ok":true'))) {
		errors.push("WORKER_STDIO_FLUSH_FAILED");
	}
	if (!responseLines.some((line) => line.includes('"id":"s1"') && line.includes('"ok":true'))) {
		errors.push("WORKER_STDIO_SHUTDOWN_FAILED");
	}
	const okCount = responseLines.filter((line) => line.includes('"ok":true')).length;
	if (okCount < fixture.events.length + 3) {
		errors.push("WORKER_STDIO_EVENT_FAILED");
	}

	const invalidJsonRecovery =
		responseLines.some((line) => line.includes("INVALID_JSON")) &&
		responseLines.some((line) => line.includes('"id":"h1"') && line.includes('"ok":true'));

	return {
		passed: errors.length === 0,
		invalidJsonRecovery,
		p95Ms: percentile95(durations),
		transcript: responseLines,
		errors,
	};
}

async function runHttpSmoke(
	client: ClientName,
	projectPath: string,
	fixture: WorkerFixture,
): Promise<{ passed: boolean; p95Ms: number; transcript: string[]; errors: string[] }> {
	const entry = workerEntry(client);
	const port = await getFreePort();
	const proc = Bun.spawn(["bun", "run", entry, "--project", projectPath, "--http-port", String(port)], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPEN_MEM_COMPRESSION: "false",
			OPEN_MEM_PLATFORM_CLAUDE_CODE: "true",
			OPEN_MEM_PLATFORM_CURSOR: "true",
		},
	});

	const baseUrl = `http://127.0.0.1:${port}`;
	const transcript: string[] = [];
	const durations: number[] = [];
	const errors: string[] = [];

	await Bun.sleep(250);

	const hit = async (method: "GET" | "POST", path: string, body?: unknown) => {
		const start = performance.now();
		const res = await fetch(`${baseUrl}${path}`, {
			method,
			headers: body ? { "Content-Type": "application/json" } : undefined,
			body: body ? JSON.stringify(body) : undefined,
		});
		const text = await res.text();
		durations.push(performance.now() - start);
		transcript.push(`${method} ${path} ${res.status} ${text}`);
		return { status: res.status, text };
	};

	const health = await hit("GET", "/v1/health");
	if (health.status !== 200 || !health.text.includes('"ok":true')) errors.push("WORKER_HTTP_HEALTH_FAILED");

	for (const event of fixture.events) {
		const sent = await hit("POST", "/v1/events", { command: "event", payload: event });
		if (sent.status !== 200 || !sent.text.includes('"ok":true')) errors.push("WORKER_HTTP_EVENT_FAILED");
	}

	const flush = await hit("POST", "/v1/events", { command: "flush", id: "hf1" });
	if (flush.status !== 200 || !flush.text.includes('"ok":true')) errors.push("WORKER_HTTP_FLUSH_FAILED");

	const shutdown = await hit("POST", "/v1/events", { command: "shutdown", id: "hs1" });
	if (shutdown.status !== 200 || !shutdown.text.includes('"ok":true')) errors.push("WORKER_HTTP_SHUTDOWN_FAILED");

	proc.stdin.end();
	const exit = await proc.exited;
	if (exit !== 0) {
		const stderr = await new Response(proc.stderr).text();
		errors.push(`WORKER_HTTP_EXIT_${exit}:${stderr}`);
	}

	return {
		passed: errors.length === 0,
		p95Ms: percentile95(durations),
		transcript,
		errors,
	};
}

export async function runWorkerSmoke(artifactsDir: string): Promise<SmokeResult[]> {
	assertExists("dist/claude-code.js", "DIST_CLAUDE_WORKER");
	assertExists("dist/cursor.js", "DIST_CURSOR_WORKER");

	const projectDir = await mkdtemp(join(tmpdir(), "open-mem-worker-smoke-"));
	try {
		const results: SmokeResult[] = [];
		for (const client of ["claude-code", "cursor"] as const) {
			const fixture = await readJsonFile<WorkerFixture>(
				`tests/fixtures/external-clients/${client}-worker.json`,
			);
			const stdio = await runStdioSmoke(client, projectDir, fixture);
			const http = await runHttpSmoke(client, projectDir, fixture);

			await writeTextFile(
				`${artifactsDir}/transcripts/${client}/worker-stdio.jsonl`,
				`${stdio.transcript.join("\n")}\n`,
			);
			await writeTextFile(
				`${artifactsDir}/transcripts/${client}/worker-http.jsonl`,
				`${http.transcript.join("\n")}\n`,
			);

			await writeTextFile(
				`${artifactsDir}/logs/${client}-worker.log`,
				[...stdio.errors, ...http.errors].join("\n"),
			);

			results.push({
				client,
				stdioPassed: stdio.passed,
				httpPassed: http.passed,
				invalidJsonRecoveryPassed: stdio.invalidJsonRecovery,
				// Use HTTP bridge latency as the ingest timing signal; stdio writes are not round-trip timed.
				eventP95Ms: http.p95Ms,
				errors: [...stdio.errors, ...http.errors],
			});
		}

		await writeJsonFile(`${artifactsDir}/worker-smoke.json`, { results });
		return results;
	} finally {
		await rm(projectDir, { recursive: true, force: true });
	}
}

async function main() {
	const { artifactsDir } = parseArgs();
	const results = await runWorkerSmoke(artifactsDir);
	const failed = results.some(
		(r) => !r.stdioPassed || !r.httpPassed || !r.invalidJsonRecoveryPassed,
	);
	if (failed) {
		console.error("[smoke-platform-workers] failed", JSON.stringify(results, null, 2));
		process.exit(1);
	}
	console.log("[smoke-platform-workers] passed", JSON.stringify(results, null, 2));
}

if (import.meta.main) {
	main().catch((error) => {
		console.error("[smoke-platform-workers] fatal", error);
		process.exit(1);
	});
}
