// =============================================================================
// open-mem — Privacy Utilities
// =============================================================================

/** Strip `<private>...</private>` blocks. Case-insensitive, multiline-safe. */
export function stripPrivateBlocks(text: string, replacement = ""): string {
	if (!text) return text;
	return text.replace(/<private>[\s\S]*?<\/private>/gi, replacement);
}

/** Redact content matching sensitive regex patterns. Invalid patterns are silently skipped. */
export function redactSensitive(
	text: string,
	patterns: string[],
	replacement = "[REDACTED]",
): string {
	if (!text || patterns.length === 0) return text;

	let result = text;
	for (const pattern of patterns) {
		try {
			result = result.replace(new RegExp(pattern, "g"), replacement);
		} catch {
			// Invalid regex — skip this pattern
		}
	}
	return result;
}
