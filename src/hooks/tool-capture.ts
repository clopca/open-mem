// =============================================================================
// open-mem — Tool Capture Hook (tool.execute.after)
// =============================================================================

import type { SessionRepository } from "../db/sessions";
import type { QueueProcessor } from "../queue/processor";
import type { OpenMemConfig } from "../types";

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

			// Skip ignored tools
			if (config.ignoredTools.includes(tool)) return;

			// Skip empty or very short outputs
			if (!toolOutput || toolOutput.length < config.minOutputLength) return;

			// Redact sensitive content (replace, don't skip)
			let processedOutput = toolOutput;
			for (const pattern of config.sensitivePatterns) {
				try {
					processedOutput = processedOutput.replace(new RegExp(pattern, "g"), "[REDACTED]");
				} catch {
					// Invalid regex — skip this pattern
				}
			}

			// Strip <private>...</private> blocks
			processedOutput = processedOutput.replace(/<private>[\s\S]*?<\/private>/g, "[PRIVATE]");

			// Ensure session record exists
			sessions.getOrCreate(sessionID, projectPath);

			// Enqueue for async processing
			queue.enqueue(sessionID, tool, processedOutput, callID);
		} catch (error) {
			// Never let hook errors propagate to OpenCode
			console.error("[open-mem] Tool capture error:", error);
		}
	};
}
