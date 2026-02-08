import { persistChatMessage } from "../../hooks/chat-capture";
import { handleSessionLifecycleEvent, type SessionLifecycleDeps } from "../../hooks/session-events";
import { enqueueToolCapture } from "../../hooks/tool-capture";
import type { OpenMemConfig } from "../../types";
import type { NormalizedPlatformEvent, PlatformAdapter, PlatformName } from "./types";

export interface PlatformIngestionRuntimeDeps {
	adapter: PlatformAdapter;
	queue: SessionLifecycleDeps["queue"];
	sessions: SessionLifecycleDeps["sessions"];
	observations: SessionLifecycleDeps["observations"];
	pendingMessages: SessionLifecycleDeps["pendingMessages"];
	projectPath: string;
	config: OpenMemConfig;
}

export class PlatformIngestionRuntime {
	private readonly adapter: PlatformAdapter;
	private readonly lifecycleDeps: SessionLifecycleDeps;
	private readonly queue: SessionLifecycleDeps["queue"];
	private readonly sessions: SessionLifecycleDeps["sessions"];
	private readonly observations: SessionLifecycleDeps["observations"];
	private readonly projectPath: string;
	private readonly config: OpenMemConfig;

	constructor(deps: PlatformIngestionRuntimeDeps) {
		this.adapter = deps.adapter;
		this.queue = deps.queue;
		this.sessions = deps.sessions;
		this.observations = deps.observations;
		this.projectPath = deps.projectPath;
		this.config = deps.config;
		this.lifecycleDeps = {
			queue: deps.queue,
			sessions: deps.sessions,
			projectPath: deps.projectPath,
			config: deps.config,
			observations: deps.observations,
			pendingMessages: deps.pendingMessages,
		};
	}

	platform(): PlatformName {
		return this.adapter.descriptor.name;
	}

	normalize(rawEvent: unknown): NormalizedPlatformEvent | null {
		return this.adapter.normalize(rawEvent);
	}

	async ingestRaw(rawEvent: unknown): Promise<boolean> {
		const normalized = this.normalize(rawEvent);
		if (!normalized) return false;
		await this.ingestNormalized(normalized);
		return true;
	}

	async ingestNormalized(event: NormalizedPlatformEvent): Promise<void> {
		switch (event.kind) {
			case "session.start":
				await handleSessionLifecycleEvent(this.lifecycleDeps, "session.created", event.sessionId);
				return;
			case "session.end":
				await handleSessionLifecycleEvent(this.lifecycleDeps, "session.ended", event.sessionId);
				return;
			case "idle.flush":
				await handleSessionLifecycleEvent(this.lifecycleDeps, "session.idle", event.sessionId);
				return;
			case "tool.execute":
				enqueueToolCapture({
					config: this.config,
					queue: this.queue,
					sessions: this.sessions,
					projectPath: this.projectPath,
					tool: event.toolName,
					sessionId: event.sessionId,
					callId: event.callId,
					toolOutput: event.output,
				});
				return;
			case "chat.message":
				persistChatMessage({
					observations: this.observations,
					sessions: this.sessions,
					projectPath: this.projectPath,
					sessionId: event.sessionId,
					text: event.text,
					agent: event.role === "user" ? "user" : event.role,
					sensitivePatterns: this.config.sensitivePatterns,
				});
				return;
		}
	}
}
