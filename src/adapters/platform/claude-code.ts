import { CLAUDE_CODE_ADAPTER } from "./builtin";
import { normalizeExternalEvent } from "./normalize";
import type { NormalizedPlatformEvent, PlatformAdapter } from "./types";

interface ClaudeCodeRawEvent {
	type?: string;
	event?: string;
	sessionId?: string;
	callId?: string;
	toolName?: string;
	output?: string;
	role?: "user" | "assistant" | "system";
	text?: string;
	occurredAt?: string;
	metadata?: Record<string, unknown>;
}

function mapClaudeEventType(raw: ClaudeCodeRawEvent): string | null {
	const event = raw.type ?? raw.event;
	if (!event) return null;
	if (event === "session.start") return "session.start";
	if (event === "session.end") return "session.end";
	if (event === "idle.flush") return "idle.flush";
	if (event === "tool.execute") return "tool.execute";
	if (event === "chat.message") return "chat.message";
	return null;
}

export class ClaudeCodeAdapter implements PlatformAdapter {
	readonly descriptor = CLAUDE_CODE_ADAPTER;

	normalize(rawEvent: unknown): NormalizedPlatformEvent | null {
		if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return null;
		const raw = rawEvent as ClaudeCodeRawEvent;
		const kind = mapClaudeEventType(raw);
		if (!kind || !raw.sessionId) return null;
		return normalizeExternalEvent("claude-code", {
			kind,
			sessionId: raw.sessionId,
			callId: raw.callId,
			toolName: raw.toolName,
			output: raw.output,
			role: raw.role,
			text: raw.text,
			occurredAt: raw.occurredAt,
			metadata: raw.metadata,
		});
	}
}

export function createClaudeCodeAdapter(): PlatformAdapter {
	return new ClaudeCodeAdapter();
}
