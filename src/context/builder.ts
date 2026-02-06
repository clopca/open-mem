// =============================================================================
// open-mem — Context String Builder
// =============================================================================

import type { ProgressiveContext } from "./progressive";

// -----------------------------------------------------------------------------
// XML Format (for system.transform injection)
// -----------------------------------------------------------------------------

/**
 * Render the progressive context as XML for injection into the system prompt.
 */
export function buildContextString(context: ProgressiveContext): string {
	const parts: string[] = [];

	parts.push("<open_mem_context>");
	parts.push(
		"  <description>Past session memory from open-mem plugin. Use mem-search tool to retrieve full observation details.</description>",
	);

	// Recent session summaries
	if (context.recentSummaries.length > 0) {
		parts.push("  <recent_sessions>");
		for (const summary of context.recentSummaries) {
			parts.push(`    <session id="${summary.sessionId}">`);
			parts.push(`      <summary>${summary.summary}</summary>`);
			if (summary.keyDecisions.length > 0) {
				parts.push(`      <decisions>${summary.keyDecisions.join("; ")}</decisions>`);
			}
			if (summary.concepts.length > 0) {
				parts.push(`      <concepts>${summary.concepts.join(", ")}</concepts>`);
			}
			parts.push("    </session>");
		}
		parts.push("  </recent_sessions>");
	}

	// Observation index (progressive disclosure)
	if (context.observationIndex.length > 0) {
		parts.push(
			'  <observation_index hint="Use mem-search tool to get full details for any observation">',
		);
		for (const entry of context.observationIndex) {
			parts.push(
				`    <entry id="${entry.id}" type="${entry.type}" session="${entry.sessionId}">${entry.title}</entry>`,
			);
		}
		parts.push("  </observation_index>");
	}

	parts.push("</open_mem_context>");

	return parts.join("\n");
}

// -----------------------------------------------------------------------------
// Plain-text Format (for session compaction)
// -----------------------------------------------------------------------------

/**
 * Render a compact plain-text context for the compaction hook.
 */
export function buildCompactContext(context: ProgressiveContext): string {
	const parts: string[] = [];

	parts.push("[open-mem] Memory context:");

	if (context.recentSummaries.length > 0) {
		parts.push("\nRecent sessions:");
		for (const summary of context.recentSummaries) {
			parts.push(`- ${summary.summary}`);
		}
	}

	if (context.observationIndex.length > 0) {
		parts.push(`\nRecent observations (${context.observationIndex.length} entries):`);
		for (const entry of context.observationIndex) {
			parts.push(`- [${entry.type}] ${entry.title}`);
		}
	}

	return parts.join("\n");
}
