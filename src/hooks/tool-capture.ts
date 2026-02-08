// =============================================================================
// open-mem — Tool Capture Hook (tool.execute.after)
// =============================================================================

import type { SessionRepository } from "../db/sessions";
import type { QueueProcessor } from "../queue/processor";
import type { OpenMemConfig } from "../types";
import { redactSensitive, stripPrivateBlocks } from "../utils/privacy";

export interface ToolCaptureInput {
	config: OpenMemConfig;
	queue: QueueProcessor;
	sessions: SessionRepository;
	projectPath: string;
	tool: string;
	sessionId: string;
	callId: string;
	toolOutput: string;
}

/** Shared capture path for any platform tool-execution event. */
export function enqueueToolCapture(input: ToolCaptureInput): boolean {
	const { config, queue, sessions, projectPath, tool, sessionId, callId, toolOutput } = input;

	// Skip ignored tools
	if (config.ignoredTools.includes(tool)) return false;

	// Skip empty or very short outputs
	if (!toolOutput || toolOutput.length < config.minOutputLength) return false;

	// Redact sensitive content and strip <private> blocks
	let processedOutput = redactSensitive(toolOutput, config.sensitivePatterns);
	processedOutput = stripPrivateBlocks(processedOutput, "[PRIVATE]");

	// Ensure session record exists
	sessions.getOrCreate(sessionId, projectPath);

	// Enqueue for async processing
	queue.enqueue(sessionId, tool, processedOutput, callId);
	return true;
}

/**
 * Factory for the `tool.execute.after` hook.
 *
 * On every tool execution the hook:
 *  1. Filters out ignored tools and short/empty outputs
 *  2. Redacts content matching sensitive patterns
 *  3. Strips `<private>...</private>` blocks
 *  4. Ensures the session exists in the DB
 *  5. Enqueues the output for async AI compression
 *
 * The handler NEVER throws — errors are caught and logged.
 */
export function createToolCaptureHook(
	config: OpenMemConfig,
	queue: QueueProcessor,
	sessions: SessionRepository,
	projectPath: string,
) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: {
			title: string;
			output: string;
			metadata: Record<string, unknown>;
		},
	): Promise<void> => {
		try {
			const { tool, sessionID, callID } = input;
			const { output: toolOutput } = output;
			enqueueToolCapture({
				config,
				queue,
				sessions,
				projectPath,
				tool,
				sessionId: sessionID,
				callId: callID,
				toolOutput,
			});
		} catch (error) {
			// Never let hook errors propagate to OpenCode
			console.error("[open-mem] Tool capture error:", error);
		}
	};
}
