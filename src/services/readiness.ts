import type { OpenMemConfig } from "../types";

export interface ReadinessInput {
	config: OpenMemConfig;
	adapterStatuses: Array<{ name: string; enabled: boolean }>;
	runtime: {
		status: "ok" | "degraded";
		queue: {
			lastError: string | null;
		};
	};
}

export interface ReadinessResult {
	ready: boolean;
	status: "ready" | "initializing" | "degraded";
	reasons: string[];
}

export interface ReadinessService {
	evaluate(input: ReadinessInput): ReadinessResult;
}

export class DefaultReadinessService implements ReadinessService {
	evaluate(input: ReadinessInput): ReadinessResult {
		const reasons: string[] = [];

		if (!input.adapterStatuses.some((adapter) => adapter.enabled)) {
			reasons.push("No platform adapters are enabled.");
		}

		if (
			input.config.compressionEnabled &&
			input.config.provider !== "bedrock" &&
			!input.config.apiKey
		) {
			reasons.push("Compression is enabled but no provider API key is configured.");
		}

		if (input.runtime.status === "degraded") {
			reasons.push("Runtime status is degraded.");
		}

		if (input.runtime.queue.lastError) {
			reasons.push(`Queue reported an error: ${input.runtime.queue.lastError}`);
		}

		if (reasons.length === 0) {
			return { ready: true, status: "ready", reasons: [] };
		}

		return {
			ready: false,
			status: input.runtime.status === "degraded" ? "degraded" : "initializing",
			reasons,
		};
	}
}
