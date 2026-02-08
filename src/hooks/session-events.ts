// =============================================================================
// open-mem — Session Event Handler
// =============================================================================

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ObservationRepository } from "../db/observations";
import type { PendingMessageRepository } from "../db/pending";
import type { SessionRepository } from "../db/sessions";
import type { QueueProcessor } from "../queue/processor";
import type { OpenCodeEvent, OpenMemConfig } from "../types";
import { updateFolderContext } from "../utils/agents-md";
import { enforceRetention } from "../utils/retention";

export interface SessionLifecycleDeps {
	queue: QueueProcessor;
	sessions: SessionRepository;
	projectPath: string;
	config: OpenMemConfig;
	observations: ObservationRepository;
	pendingMessages: PendingMessageRepository;
}

export type SessionLifecycleEventType =
	| "session.created"
	| "session.idle"
	| "session.completed"
	| "session.ended";

export async function handleSessionLifecycleEvent(
	deps: SessionLifecycleDeps,
	eventType: SessionLifecycleEventType,
	sessionId?: string,
): Promise<void> {
	const { queue, sessions, projectPath, config, observations, pendingMessages } = deps;
	switch (eventType) {
		case "session.created": {
			if (sessionId) {
				sessions.getOrCreate(sessionId, projectPath);
			}
			try {
				enforceRetention(config, observations, pendingMessages);
			} catch (error) {
				console.error("[open-mem] Retention enforcement error:", error);
			}
			try {
				await maybeAddGitignoreEntry(projectPath);
			} catch (error) {
				console.error("[open-mem] Gitignore entry error:", error);
			}
			break;
		}

		case "session.idle": {
			void queue.processBatch().catch((error) => {
				console.error("[open-mem] Background processing error:", error);
			});
			if (sessionId) {
				sessions.updateStatus(sessionId, "idle");
				void triggerFolderContext(sessionId, projectPath, config, observations).catch((error) => {
					console.error("[open-mem] Folder context error:", error);
				});
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
	}
}

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
			if (
				event.type === "session.created" ||
				event.type === "session.idle" ||
				event.type === "session.completed" ||
				event.type === "session.ended"
			) {
				await handleSessionLifecycleEvent(
					{ queue, sessions, projectPath, config, observations, pendingMessages },
					event.type,
					sessionId,
				);
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
			await updateFolderContext(projectPath, sessionObservations, {
				mode: config.folderContextMode,
				filename: config.folderContextFilename,
				maxDepth: config.folderContextMaxDepth,
			});
		}
	} catch (error) {
		console.error("[open-mem] Folder context update error:", error);
	}
}

async function maybeAddGitignoreEntry(projectPath: string): Promise<void> {
	const gitignorePath = join(projectPath, ".gitignore");
	if (!existsSync(gitignorePath)) return;

	const content = await readFile(gitignorePath, "utf-8");
	if (content.includes("AGENTS.md")) return;

	const block = `\n# open-mem: Auto-generated folder context files.\n# Uncomment to exclude from version control (recommended for large projects):\n# **/AGENTS.md\n`;
	await writeFile(
		gitignorePath,
		content.endsWith("\n") ? content + block : `${content}\n${block}`,
		"utf-8",
	);
}
