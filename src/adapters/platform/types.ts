export type PlatformName = "opencode" | "claude-code" | "cursor";

export interface PlatformCapabilities {
	nativeSessionLifecycle: boolean;
	nativeToolCapture: boolean;
	nativeChatCapture: boolean;
	emulatedIdleFlush: boolean;
}

export interface PlatformAdapterDescriptor {
	name: PlatformName;
	version: string;
	capabilities: PlatformCapabilities;
}

export type NormalizedPlatformEvent =
	| {
			kind: "session.start";
			platform: PlatformName;
			sessionId: string;
			occurredAt: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			kind: "session.end";
			platform: PlatformName;
			sessionId: string;
			occurredAt: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			kind: "chat.message";
			platform: PlatformName;
			sessionId: string;
			occurredAt: string;
			role: "user" | "assistant" | "system";
			text: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			kind: "tool.execute";
			platform: PlatformName;
			sessionId: string;
			occurredAt: string;
			callId: string;
			toolName: string;
			output: string;
			metadata?: Record<string, unknown>;
	  }
	| {
			kind: "idle.flush";
			platform: PlatformName;
			sessionId: string;
			occurredAt: string;
			metadata?: Record<string, unknown>;
	  };

export interface PlatformAdapter {
	readonly descriptor: PlatformAdapterDescriptor;
	normalize(rawEvent: unknown): NormalizedPlatformEvent | null;
}
