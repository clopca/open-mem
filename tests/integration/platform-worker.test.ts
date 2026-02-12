import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";

const tempDirs: string[] = [];

function createTempProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "open-mem-platform-"));
	tempDirs.push(dir);
	return dir;
}

async function runWorker(
	entry: "claude-code" | "cursor",
	project: string,
	lines: string[],
): Promise<Array<{ ok: boolean; code: string; message?: string }>> {
	const proc = Bun.spawn([process.execPath, "run", `src/${entry}.ts`, "--project", project], {
		cwd: join(import.meta.dir, "../.."),
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

	proc.stdin.write(`${lines.join("\n")}\n`);
	proc.stdin.end();

	const stdout = await new Response(proc.stdout).text();
	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`worker failed (${entry}): ${stderr}`);
	}
	return stdout
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as { ok: boolean; code: string; message?: string });
}

function readProject(project: string) {
	const db = createDatabase(join(project, ".open-mem", "memory.db"));
	initializeSchema(db, { hasVectorExtension: db.hasVectorExtension, embeddingDimension: 768 });
	const observations = new ObservationRepository(db);
	const sessions = new SessionRepository(db);
	const session = sessions.getById("sess-1");
	const items = observations.getBySession("sess-1");
	db.close();
	return { session, items };
}

describe("platform workers", () => {
	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("claude-code worker ingests JSON events", async () => {
		const project = createTempProject();
		const responses = await runWorker("claude-code", project, [
			JSON.stringify({ type: "session.start", sessionId: "sess-1" }),
			JSON.stringify({
				type: "tool.execute",
				sessionId: "sess-1",
				callId: "call-1",
				toolName: "Read",
				output:
					"Read src/index.ts and found platform ingestion wiring plus lifecycle hooks for worker adapters.",
			}),
			JSON.stringify({
				type: "chat.message",
				sessionId: "sess-1",
				role: "user",
				text: "Ensure platform adapter behavior is equivalent across all surfaces.",
			}),
			JSON.stringify({ type: "idle.flush", sessionId: "sess-1" }),
			JSON.stringify({ type: "session.end", sessionId: "sess-1" }),
		]);
		expect(responses.length).toBe(5);
		expect(responses.every((r) => r.ok)).toBe(true);

		const { session, items } = readProject(project);
		expect(session?.status).toBe("completed");
		expect(items.length).toBeGreaterThanOrEqual(2);
	});

	test("cursor worker ingests cursor-style events", async () => {
		const project = createTempProject();
		const responses = await runWorker("cursor", project, [
			JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
			JSON.stringify({
				eventName: "toolExecute",
				session: "sess-1",
				invocationId: "call-1",
				tool: "Read",
				output:
					"Read src/index.ts and found platform ingestion wiring plus lifecycle hooks for worker adapters.",
			}),
			JSON.stringify({
				eventName: "chatMessage",
				session: "sess-1",
				role: "user",
				message: "Ensure platform adapter behavior is equivalent across all surfaces.",
			}),
			JSON.stringify({ eventName: "idleFlush", session: "sess-1" }),
			JSON.stringify({ eventName: "sessionEnd", session: "sess-1" }),
		]);
		expect(responses.length).toBe(5);
		expect(responses.every((r) => r.ok)).toBe(true);

		const { session, items } = readProject(project);
		expect(session?.status).toBe("completed");
		expect(items.length).toBeGreaterThanOrEqual(2);
	});

	test("worker emits structured error response for invalid JSON", async () => {
		const project = createTempProject();
		const responses = await runWorker("cursor", project, [
			"not-json",
			JSON.stringify({ eventName: "sessionStart", session: "sess-1" }),
		]);
		expect(responses[0].ok).toBe(false);
		expect(responses[0].code).toBe("INVALID_JSON");
		expect(responses[1].ok).toBe(true);
	});
});
