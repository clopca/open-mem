import { describe, expect, test } from "bun:test";
import {
	createClaudeCodeAdapter,
	createCursorAdapter,
	createOpenCodePlatformAdapter,
} from "../../src/adapters/platform";

describe("platform adapters", () => {
	test("OpenCode adapter normalizes hook payload", () => {
		const adapter = createOpenCodePlatformAdapter();
		const event = adapter.normalize({
			eventType: "tool.execute.after",
			payload: { sessionID: "s1", callID: "c1", tool: "Read" },
			output: { output: "content", title: "Read" },
		});
		expect(event?.kind).toBe("tool.execute");
		expect(event?.platform).toBe("opencode");
	});

	test("Claude adapter maps external schema", () => {
		const adapter = createClaudeCodeAdapter();
		const event = adapter.normalize({
			type: "tool.execute",
			sessionId: "s1",
			callId: "c1",
			toolName: "Read",
			output: "content",
		});
		expect(event?.kind).toBe("tool.execute");
		expect(event?.platform).toBe("claude-code");
	});

	test("Cursor adapter maps cursor-style fields", () => {
		const adapter = createCursorAdapter();
		const event = adapter.normalize({
			eventName: "chatMessage",
			session: "s1",
			message: "hi",
			role: "user",
		});
		expect(event?.kind).toBe("chat.message");
		expect(event?.platform).toBe("cursor");
	});
});
