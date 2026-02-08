import { CURSOR_ADAPTER } from "./builtin";
import { normalizeExternalEvent } from "./normalize";
import type { NormalizedPlatformEvent, PlatformAdapter } from "./types";

interface CursorRawEvent {
	eventName?: string;
	event?: string;
	session?: string;
	sessionId?: string;
	invocationId?: string;
	callId?: string;
	tool?: string;
	toolName?: string;
	output?: string;
	message?: string;
	text?: string;
	role?: "user" | "assistant" | "system";
	timestamp?: string;
	occurredAt?: string;
	meta?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

function mapCursorEventType(raw: CursorRawEvent): string | null {
	const event = raw.eventName ?? raw.event;
	if (!event) return null;
	if (event === "sessionStart") return "session.start";
	if (event === "sessionEnd") return "session.end";
	if (event === "idleFlush") return "idle.flush";
	if (event === "toolExecute") return "tool.execute";
	if (event === "chatMessage") return "chat.message";
	return null;
}

export class CursorAdapter implements PlatformAdapter {
	readonly descriptor = CURSOR_ADAPTER;

	normalize(rawEvent: unknown): NormalizedPlatformEvent | null {
		if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return null;
		const raw = rawEvent as CursorRawEvent;
		const kind = mapCursorEventType(raw);
		const sessionId = raw.sessionId ?? raw.session;
		if (!kind || !sessionId) return null;
		return normalizeExternalEvent("cursor", {
			kind,
			sessionId,
			callId: raw.callId ?? raw.invocationId,
			toolName: raw.toolName ?? raw.tool,
			output: raw.output,
			role: raw.role,
			text: raw.text ?? raw.message,
			occurredAt: raw.occurredAt ?? raw.timestamp,
			metadata: raw.metadata ?? raw.meta,
		});
	}
}

export function createCursorAdapter(): PlatformAdapter {
	return new CursorAdapter();
}
