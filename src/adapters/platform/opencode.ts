import { OPEN_CODE_ADAPTER } from "./builtin";
import { normalizeOpenCodeEvent } from "./normalize";
import type { NormalizedPlatformEvent, PlatformAdapter } from "./types";

interface OpenCodeRawPayload {
	eventType?: "tool.execute.after" | "chat.message" | "event";
	payload?: unknown;
	output?: unknown;
}

export class OpenCodeAdapter implements PlatformAdapter {
	readonly descriptor = OPEN_CODE_ADAPTER;

	normalize(rawEvent: unknown): NormalizedPlatformEvent | null {
		if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) return null;
		const raw = rawEvent as OpenCodeRawPayload;
		if (!raw.eventType) return null;
		return normalizeOpenCodeEvent({
			eventType: raw.eventType,
			payload: raw.payload,
			output: raw.output,
		});
	}
}

export function createOpenCodePlatformAdapter(): PlatformAdapter {
	return new OpenCodeAdapter();
}
