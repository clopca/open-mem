// =============================================================================
// open-mem — Session Event Handler
// =============================================================================

import type { SessionRepository } from "../db/sessions";
import type { QueueProcessor } from "../queue/processor";
import type { OpenCodeEvent } from "../types";

/**
 * Factory for the `event` hook.
 *
 * Handles session lifecycle events:
 * - `session.created`  — ensure session record exists
 * - `session.idle`     — trigger batch processing
 * - `session.completed` / `session.ended` — process remaining queue,
 *   summarize, and mark session complete
 *
 * The handler NEVER throws.
 */
export function createEventHandler(
	queue: QueueProcessor,
	sessions: SessionRepository,
	projectPath: string,
) {
	return async (input: { event: OpenCodeEvent }): Promise<void> => {
		try {
			const { event } = input;
			const sessionId = event.properties.sessionID as string | undefined;

			switch (event.type) {
				case "session.created": {
					if (sessionId) {
						sessions.getOrCreate(sessionId, projectPath);
					}
					break;
				}

				case "session.idle": {
					await queue.processBatch();
					if (sessionId) {
						sessions.updateStatus(sessionId, "idle");
					}
					break;
				}

				case "session.completed":
				case "session.ended": {
					if (sessionId) {
						await queue.processBatch();
						await queue.summarizeSession(sessionId);
						sessions.markCompleted(sessionId);
					}
					break;
				}

				default:
					break;
			}
		} catch (error) {
			console.error("[open-mem] Event handler error:", error);
		}
	};
}
