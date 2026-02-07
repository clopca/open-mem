// =============================================================================
// open-mem — Chat Capture Hook (chat.message)
// =============================================================================

import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";

const MIN_MESSAGE_LENGTH = 20;
const MAX_NARRATIVE_LENGTH = 2000;
const MAX_TITLE_CONTENT_LENGTH = 60;

/**
 * Extract text from message parts (typed as `unknown[]`).
 * Handles both plain strings and objects with a `text` property.
 */
function extractTextFromParts(parts: unknown[]): string {
	const texts: string[] = [];
	for (const part of parts) {
		if (typeof part === "string") {
			texts.push(part);
		} else if (
			part &&
			typeof part === "object" &&
			"text" in part &&
			typeof (part as { text: unknown }).text === "string"
		) {
			texts.push((part as { text: string }).text);
		}
	}
	return texts.join("\n").trim();
}

function extractConcepts(text: string): string[] {
	const words = text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 4);

	return [...new Set(words)].slice(0, 5);
}

/**
 * Factory for the `chat.message` hook.
 *
 * Captures user messages as searchable observations so the "why"
 * behind tool executions is preserved in memory.
 *
 * The handler NEVER throws — errors are caught and logged.
 */
export function createChatCaptureHook(
	observations: ObservationRepository,
	sessions: SessionRepository,
	projectPath: string,
) {
	return async (
		input: {
			sessionID: string;
			agent?: string;
			model?: string;
			messageID?: string;
		},
		output: { message: unknown; parts: unknown[] },
	): Promise<void> => {
		try {
			const { sessionID, agent } = input;

			// User messages have agent=undefined; assistant messages have agent set to model name
			if (agent !== undefined && agent !== "user") return;

			const text = extractTextFromParts(output.parts);
			if (text.length < MIN_MESSAGE_LENGTH) return;

			sessions.getOrCreate(sessionID, projectPath);

			const truncatedContent =
				text.length > MAX_TITLE_CONTENT_LENGTH
					? `${text.slice(0, MAX_TITLE_CONTENT_LENGTH)}...`
					: text;
			const title = `User request: ${truncatedContent}`;

			const narrative =
				text.length > MAX_NARRATIVE_LENGTH ? `${text.slice(0, MAX_NARRATIVE_LENGTH)}...` : text;

			observations.create({
				sessionId: sessionID,
				type: "discovery",
				title,
				subtitle: "",
				facts: [],
				narrative,
				concepts: extractConcepts(text),
				filesRead: [],
				filesModified: [],
				rawToolOutput: "",
				toolName: "chat.message",
				tokenCount: Math.ceil(narrative.length / 4),
				discoveryTokens: 0,
			});
		} catch (error) {
			console.error("[open-mem] Chat capture error:", error);
		}
	};
}
