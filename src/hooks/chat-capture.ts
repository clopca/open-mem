// =============================================================================
// open-mem — Chat Capture Hook (chat.message)
// =============================================================================

import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import { redactSensitive, stripPrivateBlocks } from "../utils/privacy";

const MIN_MESSAGE_LENGTH = 20;
const MAX_NARRATIVE_LENGTH = 2000;
const MAX_TITLE_CONTENT_LENGTH = 60;

/**
 * Type guard: checks whether a value is an object with a string `text` property.
 */
function hasTextProperty(value: unknown): value is { text: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"text" in value &&
		typeof (value as Record<string, unknown>).text === "string"
	);
}

/**
 * Extract text from message parts (typed as `unknown[]`).
 * Handles both plain strings and objects with a `text` property.
 */
function extractTextFromParts(parts: unknown[]): string {
	const texts: string[] = [];
	for (const part of parts) {
		if (typeof part === "string") {
			texts.push(part);
		} else if (hasTextProperty(part)) {
			texts.push(part.text);
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

export interface ChatCaptureInput {
	observations: ObservationRepository;
	sessions: SessionRepository;
	projectPath: string;
	sessionId: string;
	text: string;
	agent?: string;
	sensitivePatterns?: string[];
}

/** Shared capture path for chat messages across platforms. */
export function persistChatMessage(input: ChatCaptureInput): boolean {
	const {
		observations,
		sessions,
		projectPath,
		sessionId,
		text,
		agent,
		sensitivePatterns = [],
	} = input;

	// User messages have agent=undefined; assistant messages have agent set to model name
	if (agent !== undefined && agent !== "user") return false;

	// Strip private blocks and redact sensitive content before any processing
	const processedText = redactSensitive(stripPrivateBlocks(text), sensitivePatterns);
	if (processedText.length < MIN_MESSAGE_LENGTH) return false;

	sessions.getOrCreate(sessionId, projectPath);

	const truncatedContent =
		processedText.length > MAX_TITLE_CONTENT_LENGTH
			? `${processedText.slice(0, MAX_TITLE_CONTENT_LENGTH)}...`
			: processedText;
	const title = `User request: ${truncatedContent}`;

	const narrative =
		processedText.length > MAX_NARRATIVE_LENGTH
			? `${processedText.slice(0, MAX_NARRATIVE_LENGTH)}...`
			: processedText;

	observations.create({
		sessionId,
		type: "discovery",
		title,
		subtitle: "",
		facts: [],
		narrative,
		concepts: extractConcepts(processedText),
		filesRead: [],
		filesModified: [],
		rawToolOutput: "",
		toolName: "chat.message",
		tokenCount: Math.ceil(narrative.length / 4),
		discoveryTokens: 0,
		importance: 3,
	});
	return true;
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
	sensitivePatterns: string[] = [],
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
			persistChatMessage({
				observations,
				sessions,
				projectPath,
				sessionId: sessionID,
				text,
				agent,
				sensitivePatterns,
			});
		} catch (error) {
			console.error("[open-mem] Chat capture error:", error);
		}
	};
}
