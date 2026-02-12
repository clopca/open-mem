import { afterEach, describe, expect, test } from "bun:test";
import {
	createClaudeCodeAdapter,
	createCursorAdapter,
	createOpenCodePlatformAdapter,
	PlatformIngestionRuntime,
} from "../../src/adapters/platform";
import { ObservationCompressor } from "../../src/ai/compressor";
import { SessionSummarizer } from "../../src/ai/summarizer";
import { getDefaultConfig } from "../../src/config";
import { createDatabase, type Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { PendingMessageRepository } from "../../src/db/pending";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { QueueProcessor } from "../../src/queue/processor";

interface Harness {
	db: Database;
	observations: ObservationRepository;
	sessions: SessionRepository;
	runtime: PlatformIngestionRuntime;
}

const resources: Array<{ db: Database }> = [];

function createHarness(kind: "opencode" | "claude" | "cursor"): Harness {
	const db = createDatabase(":memory:");
	initializeSchema(db, { hasVectorExtension: false, embeddingDimension: 0 });
	resources.push({ db });

	const config = {
		...getDefaultConfig(),
		compressionEnabled: false,
		batchSize: 10,
		minOutputLength: 1,
	};
	const observations = new ObservationRepository(db);
	const sessions = new SessionRepository(db);
	const summaries = new SummaryRepository(db);
	const pending = new PendingMessageRepository(db);

	const queue = new QueueProcessor(
		config,
		new ObservationCompressor(config),
		new SessionSummarizer(config),
		pending,
		observations,
		sessions,
		summaries,
	);

	const adapter =
		kind === "opencode"
			? createOpenCodePlatformAdapter()
			: kind === "claude"
				? createClaudeCodeAdapter()
				: createCursorAdapter();

	const runtime = new PlatformIngestionRuntime({
		adapter,
		queue,
		sessions,
		observations,
		pendingMessages: pending,
		projectPath: "/tmp/platform-parity",
		config,
	});

	return { db, observations, sessions, runtime };
}

async function replay(kind: "opencode" | "claude" | "cursor", runtime: PlatformIngestionRuntime) {
	if (kind === "opencode") {
		await runtime.ingestRaw({
			eventType: "event",
			payload: { event: { type: "session.created", properties: { sessionID: "sess-1" } } },
		});
		await runtime.ingestRaw({
			eventType: "tool.execute.after",
			payload: { sessionID: "sess-1", callID: "call-1", tool: "Read" },
			output: {
				title: "Read file",
				output:
					"Read src/index.ts and found queue wiring for adapters and lifecycle handling details.",
				metadata: {},
			},
		});
		await runtime.ingestRaw({
			eventType: "chat.message",
			payload: { sessionID: "sess-1" },
			output: {
				message: { role: "user", content: "Please preserve adapter behavior across platforms." },
				parts: ["Please preserve adapter behavior across platforms."],
			},
		});
		await runtime.ingestRaw({
			eventType: "event",
			payload: { event: { type: "session.idle", properties: { sessionID: "sess-1" } } },
		});
		await runtime.ingestRaw({
			eventType: "event",
			payload: { event: { type: "session.ended", properties: { sessionID: "sess-1" } } },
		});
		return;
	}

	if (kind === "claude") {
		await runtime.ingestRaw({ type: "session.start", sessionId: "sess-1" });
		await runtime.ingestRaw({
			type: "tool.execute",
			sessionId: "sess-1",
			callId: "call-1",
			toolName: "Read",
			output:
				"Read src/index.ts and found queue wiring for adapters and lifecycle handling details.",
		});
		await runtime.ingestRaw({
			type: "chat.message",
			sessionId: "sess-1",
			role: "user",
			text: "Please preserve adapter behavior across platforms.",
		});
		await runtime.ingestRaw({ type: "idle.flush", sessionId: "sess-1" });
		await runtime.ingestRaw({ type: "session.end", sessionId: "sess-1" });
		return;
	}

	await runtime.ingestRaw({ eventName: "sessionStart", session: "sess-1" });
	await runtime.ingestRaw({
		eventName: "toolExecute",
		session: "sess-1",
		invocationId: "call-1",
		tool: "Read",
		output:
			"Read src/index.ts and found queue wiring for adapters and lifecycle handling details.",
	});
	await runtime.ingestRaw({
		eventName: "chatMessage",
		session: "sess-1",
		role: "user",
		message: "Please preserve adapter behavior across platforms.",
	});
	await runtime.ingestRaw({ eventName: "idleFlush", session: "sess-1" });
	await runtime.ingestRaw({ eventName: "sessionEnd", session: "sess-1" });
}

function normalizedObservations(h: Harness): Array<{ type: string; title: string; tool: string }> {
	return h.observations
		.getBySession("sess-1")
		.map((obs) => ({ type: obs.type, title: obs.title, tool: obs.toolName }))
		.sort((a, b) => `${a.tool}:${a.title}`.localeCompare(`${b.tool}:${b.title}`));
}

describe("platform parity harness", () => {
	afterEach(() => {
		for (const resource of resources.splice(0)) {
			resource.db.close();
		}
	});

	test("OpenCode, Claude Code, and Cursor replay equivalent memory outcomes", async () => {
		const openCode = createHarness("opencode");
		const claude = createHarness("claude");
		const cursor = createHarness("cursor");

		await replay("opencode", openCode.runtime);
		await replay("claude", claude.runtime);
		await replay("cursor", cursor.runtime);

		const base = normalizedObservations(openCode);
		expect(base.length).toBeGreaterThan(0);
		expect(normalizedObservations(claude)).toEqual(base);
		expect(normalizedObservations(cursor)).toEqual(base);

		expect(openCode.sessions.getById("sess-1")?.status).toBe("completed");
		expect(claude.sessions.getById("sess-1")?.status).toBe("completed");
		expect(cursor.sessions.getById("sess-1")?.status).toBe("completed");
	});
});
