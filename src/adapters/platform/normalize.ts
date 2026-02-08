import type { NormalizedPlatformEvent, PlatformName } from "./types";

function nowIso(): string {
	return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Normalize OpenCode hook payloads into a platform-agnostic event shape.
 */
export function normalizeOpenCodeEvent(input: {
	eventType: "tool.execute.after" | "chat.message" | "event";
	payload: unknown;
	output?: unknown;
}): NormalizedPlatformEvent | null {
	if (input.eventType === "tool.execute.after") {
		const p = asObject(input.payload);
		const out = asObject(input.output);
		if (!p || !out) return null;
		const sessionId = asString(p.sessionID);
		const callId = asString(p.callID);
		const toolName = asString(p.tool);
		const output = asString(out.output);
		if (!sessionId || !callId || !toolName || !output) return null;
		return {
			kind: "tool.execute",
			platform: "opencode",
			sessionId,
			callId,
			toolName,
			output,
			occurredAt: nowIso(),
			metadata: { title: out.title },
		};
	}

	if (input.eventType === "chat.message") {
		const p = asObject(input.payload);
		const out = asObject(input.output);
		if (!p || !out) return null;
		const sessionId = asString(p.sessionID);
		const message = asObject(out.message);
		const role = asString(message?.role) ?? "user";
		const text = asString(message?.content);
		if (!sessionId || !text) return null;
		return {
			kind: "chat.message",
			platform: "opencode",
			sessionId,
			role: role === "assistant" || role === "system" ? role : "user",
			text,
			occurredAt: nowIso(),
		};
	}

	const p = asObject(input.payload);
	if (!p) return null;
	const event = asObject(p.event);
	const eventType = asString(event?.type);
	const props = asObject(event?.properties);
	const sessionId = asString(props?.sessionID);
	if (!eventType || !sessionId) return null;

	if (eventType === "session.idle") {
		return {
			kind: "idle.flush",
			platform: "opencode",
			sessionId,
			occurredAt: nowIso(),
		};
	}

	if (eventType === "session.started") {
		return {
			kind: "session.start",
			platform: "opencode",
			sessionId,
			occurredAt: nowIso(),
			metadata: props ?? undefined,
		};
	}

	if (eventType === "session.created") {
		return {
			kind: "session.start",
			platform: "opencode",
			sessionId,
			occurredAt: nowIso(),
			metadata: props ?? undefined,
		};
	}

	if (eventType === "session.ended") {
		return {
			kind: "session.end",
			platform: "opencode",
			sessionId,
			occurredAt: nowIso(),
			metadata: props ?? undefined,
		};
	}

	if (eventType === "session.completed") {
		return {
			kind: "session.end",
			platform: "opencode",
			sessionId,
			occurredAt: nowIso(),
			metadata: props ?? undefined,
		};
	}

	return null;
}

/**
 * Normalize external adapter events (Claude Code / Cursor) to common schema.
 */
export function normalizeExternalEvent(
	platform: Exclude<PlatformName, "opencode">,
	raw: unknown,
): NormalizedPlatformEvent | null {
	const obj = asObject(raw);
	if (!obj) return null;
	const kind = asString(obj.kind);
	const sessionId = asString(obj.sessionId);
	if (!kind || !sessionId) return null;

	if (kind === "session.start" || kind === "session.end" || kind === "idle.flush") {
		return {
			kind,
			platform,
			sessionId,
			occurredAt: asString(obj.occurredAt) ?? nowIso(),
			metadata: asObject(obj.metadata) ?? undefined,
		};
	}

	if (kind === "chat.message") {
		const text = asString(obj.text);
		if (!text) return null;
		const role = asString(obj.role);
		return {
			kind,
			platform,
			sessionId,
			text,
			role: role === "assistant" || role === "system" ? role : "user",
			occurredAt: asString(obj.occurredAt) ?? nowIso(),
			metadata: asObject(obj.metadata) ?? undefined,
		};
	}

	if (kind === "tool.execute") {
		const toolName = asString(obj.toolName);
		const output = asString(obj.output);
		if (!toolName || !output) return null;
		return {
			kind,
			platform,
			sessionId,
			callId: asString(obj.callId) ?? `${platform}-${Date.now()}`,
			toolName,
			output,
			occurredAt: asString(obj.occurredAt) ?? nowIso(),
			metadata: asObject(obj.metadata) ?? undefined,
		};
	}

	return null;
}
