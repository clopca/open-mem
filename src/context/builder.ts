// =============================================================================
// open-mem — Context String Builder
// =============================================================================

import type { Observation, ObservationIndex, ObservationType } from "../types";
import type { ProgressiveContext } from "./progressive";

// -----------------------------------------------------------------------------
// Type Icons
// -----------------------------------------------------------------------------

const TYPE_ICONS: Record<ObservationType, string> = {
	bugfix: "🔴",
	feature: "🟣",
	refactor: "🔄",
	change: "✅",
	discovery: "🔵",
	decision: "⚖️",
};

// -----------------------------------------------------------------------------
// Markdown Format (for system.transform injection)
// -----------------------------------------------------------------------------

export function buildContextString(context: ProgressiveContext): string {
	const parts: string[] = [];

	parts.push("## open-mem: Past Session Memory");
	parts.push("");
	parts.push(
		"**💡 Progressive Disclosure:** This is a compact index showing WHAT was observed and retrieval COST.",
	);
	parts.push(
		"Use `mem-search` to find observations by query, then `mem-recall` with IDs to fetch full details.",
	);

	if (context.recentSummaries.length > 0) {
		parts.push("");
		parts.push("### Recent Sessions");
		parts.push("| Session | Summary | Decisions |");
		parts.push("|---------|---------|-----------|");
		for (const summary of context.recentSummaries) {
			const decisions = summary.keyDecisions.length > 0 ? summary.keyDecisions.join("; ") : "—";
			parts.push(`| ${summary.sessionId} | ${summary.summary} | ${decisions} |`);
		}
	}

	if (context.observationIndex.length > 0) {
		parts.push("");
		parts.push(`### Recent Observations (${context.observationIndex.length} entries)`);

		const groups = groupByFile(context.observationIndex, context.fullObservations);
		for (const [file, entries] of groups) {
			parts.push("");
			parts.push(`**${file}**`);
			parts.push("| ID | Type | Title | ~Tokens |");
			parts.push("|----|------|-------|---------|");
			for (const entry of entries) {
				const icon = TYPE_ICONS[entry.type] || "📝";
				parts.push(`| ${entry.id} | ${icon} | ${entry.title} | ~${entry.tokenCount} |`);
			}
		}
	}

	if (context.fullObservations.length > 0) {
		parts.push("");
		parts.push("### Full Details (most recent)");
		for (const obs of context.fullObservations) {
			const icon = TYPE_ICONS[obs.type] || "📝";
			parts.push("");
			parts.push(`#### ${icon} ${obs.title} (${obs.id})`);
			parts.push(obs.narrative);
			if (obs.facts.length > 0) {
				parts.push(`**Facts:** ${obs.facts.map((f) => `- ${f}`).join(" ")}`);
			}
			if (obs.concepts.length > 0) {
				parts.push(`**Concepts:** ${obs.concepts.join(", ")}`);
			}
			const files = [...obs.filesRead, ...obs.filesModified];
			if (files.length > 0) {
				parts.push(`**Files:** ${files.join(", ")}`);
			}
		}
	}

	return parts.join("\n");
}

// -----------------------------------------------------------------------------
// File Grouping Helper
// -----------------------------------------------------------------------------

function groupByFile(
	entries: ObservationIndex[],
	fullObservations: Observation[],
): Map<string, ObservationIndex[]> {
	const fileLookup = new Map<string, string>();
	for (const obs of fullObservations) {
		const firstFile = obs.filesModified[0] || obs.filesRead[0];
		if (firstFile) fileLookup.set(obs.id, firstFile);
	}

	const groups = new Map<string, ObservationIndex[]>();
	for (const entry of entries) {
		const key = fileLookup.get(entry.id) ?? "General";
		const list = groups.get(key) ?? [];
		list.push(entry);
		groups.set(key, list);
	}
	return groups;
}

// -----------------------------------------------------------------------------
// Plain-text Format (for session compaction)
// -----------------------------------------------------------------------------

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
			parts.push(`- ${TYPE_ICONS[entry.type] || "📝"} ${entry.title}`);
		}
	}

	return parts.join("\n");
}
