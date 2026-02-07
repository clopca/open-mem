// =============================================================================
// open-mem — Privacy Utilities
// =============================================================================

/** Strip `<private>...</private>` blocks. Case-insensitive, multiline-safe. */
export function stripPrivateBlocks(text: string, replacement = ""): string {
	if (!text) return text;
	return text.replace(/<private>[\s\S]*?<\/private>/gi, replacement);
}

/** Maximum pattern length to prevent excessive compilation time */
const MAX_PATTERN_LENGTH = 200;

/** Detect patterns prone to catastrophic backtracking (nested quantifiers) */
const DANGEROUS_PATTERN = /(\([\s\S]*[+*]\)\s*[+*?])|(\(\.\*\)\+)|(\(\.\+\)\+)/;

/** Redact content matching sensitive regex patterns. Invalid/dangerous patterns are skipped with a warning. */
export function redactSensitive(
	text: string,
	patterns: string[],
	replacement = "[REDACTED]",
): string {
	if (!text || patterns.length === 0) return text;

	let result = text;
	for (const pattern of patterns) {
		if (pattern.length > MAX_PATTERN_LENGTH) {
			console.warn(
				`[open-mem] Skipping oversized redaction pattern (${pattern.length} chars, max ${MAX_PATTERN_LENGTH})`,
			);
			continue;
		}
		if (DANGEROUS_PATTERN.test(pattern)) {
			console.warn(
				"[open-mem] Skipping potentially dangerous redaction pattern (nested quantifiers detected)",
			);
			continue;
		}
		try {
			result = result.replace(new RegExp(pattern, "g"), replacement);
		} catch {
			// Invalid regex — skip this pattern
		}
	}
	return result;
}
