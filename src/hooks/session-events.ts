// =============================================================================
// open-mem — Session Event Handler
// =============================================================================

import type { ObservationRepository } from "../db/observations";
import type { PendingMessageRepository } from "../db/pending";
import type { SessionRepository } from "../db/sessions";
import type { QueueProcessor } from "../queue/processor";
import type { OpenCodeEvent, OpenMemConfig } from "../types";
import { updateFolderContext } from "../utils/agents-md";
import { enforceRetention } from "../utils/retention";

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
	config: OpenMemConfig,
	observations: ObservationRepository,
	pendingMessages: PendingMessageRepository,
) {
	return async (input: { event: OpenCodeEvent }): Promise<void> => {
		try {
			const { event } = input;
			const rawSessionId = event.properties.sessionID;
			const sessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;

			switch (event.type) {
				case "session.created": {
					if (sessionId) {
						sessions.getOrCreate(sessionId, projectPath);
					}
					try {
						enforceRetention(config, observations, pendingMessages);
					} catch (error) {
						console.error("[open-mem] Retention enforcement error:", error);
					}
					break;
				}

				case "session.idle": {
					void queue.processBatch().catch((error) => {
						console.error("[open-mem] Background processing error:", error);
					});
					if (sessionId) {
						sessions.updateStatus(sessionId, "idle");
						void triggerFolderContext(sessionId, projectPath, config, observations).catch(
							(error) => {
								console.error("[open-mem] Folder context error:", error);
							},
						);
					}
					break;
				}

				case "session.completed":
				case "session.ended": {
					if (sessionId) {
						await queue.processBatch();
						await queue.summarizeSession(sessionId);
						sessions.markCompleted(sessionId);
						await triggerFolderContext(sessionId, projectPath, config, observations);
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

async function triggerFolderContext(
	sessionId: string,
	projectPath: string,
	config: OpenMemConfig,
	observationRepo: ObservationRepository,
): Promise<void> {
	if (!config.folderContextEnabled) return;

	try {
		const sessionObservations = observationRepo.getBySession(sessionId);
		if (sessionObservations.length > 0) {
			await updateFolderContext(projectPath, sessionObservations, config.folderContextMaxDepth);
		}
	} catch (error) {
		console.error("[open-mem] Folder context update error:", error);
	}
}
