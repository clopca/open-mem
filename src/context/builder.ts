// =============================================================================
// open-mem — Context String Builder
// =============================================================================

import type { Observation, ObservationIndex, ObservationType } from "../types";
import type { ProgressiveContext } from "./progressive";

// -----------------------------------------------------------------------------
// Builder Configuration
// -----------------------------------------------------------------------------

export interface ContextBuilderConfig {
	showTokenCosts: boolean;
	observationTypes: ObservationType[] | "all";
	fullObservationCount: number;
	showLastSummary: boolean;
}

const DEFAULT_BUILDER_CONFIG: ContextBuilderConfig = {
	showTokenCosts: true,
	observationTypes: "all",
	fullObservationCount: 3,
	showLastSummary: true,
};

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

export function buildContextString(
	context: ProgressiveContext,
	config: ContextBuilderConfig = DEFAULT_BUILDER_CONFIG,
): string {
	const parts: string[] = [];

	parts.push("## open-mem: Past Session Memory");
	parts.push("");
	parts.push(
		"**💡 Progressive Disclosure:** This is a compact index showing WHAT was observed and retrieval COST.",
	);
	parts.push(
		"Use `mem-search` to find observations by query, then `mem-recall` with IDs to fetch full details.",
	);

	if (config.showLastSummary && context.recentSummaries.length > 0) {
		parts.push("");
		parts.push("### Recent Sessions");
		parts.push("| Session | Summary | Decisions |");
		parts.push("|---------|---------|-----------|");
		for (const summary of context.recentSummaries) {
			const decisions = summary.keyDecisions.length > 0 ? summary.keyDecisions.join("; ") : "—";
			parts.push(`| ${summary.sessionId} | ${summary.summary} | ${decisions} |`);
		}
	}

	const filteredIndex =
		config.observationTypes === "all"
			? context.observationIndex
			: context.observationIndex.filter((e) => config.observationTypes.includes(e.type));

	if (filteredIndex.length > 0) {
		parts.push("");
		parts.push(`### Recent Observations (${filteredIndex.length} entries)`);

		const groups = groupByFile(filteredIndex, context.fullObservations);
		for (const [file, entries] of groups) {
			parts.push("");
			parts.push(`**${file}**`);
			if (config.showTokenCosts) {
				parts.push("| ID | Type | Title | ~Tokens |");
				parts.push("|----|------|-------|---------|");
			} else {
				parts.push("| ID | Type | Title |");
				parts.push("|----|------|-------|");
			}
			for (const entry of entries) {
				const icon = TYPE_ICONS[entry.type] || "📝";
				if (config.showTokenCosts) {
					parts.push(`| ${entry.id} | ${icon} | ${entry.title} | ~${entry.tokenCount} |`);
				} else {
					parts.push(`| ${entry.id} | ${icon} | ${entry.title} |`);
				}
			}
		}
	}

	const slicedFullObservations = context.fullObservations.slice(0, config.fullObservationCount);

	if (slicedFullObservations.length > 0) {
		parts.push("");
		parts.push("### Full Details (most recent)");
		for (const obs of slicedFullObservations) {
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

	const roiFooter = buildRoiFooter(context);
	if (roiFooter) {
		parts.push("");
		parts.push(roiFooter);
	}

	return parts.join("\n");
}

// -----------------------------------------------------------------------------
// ROI Footer
// -----------------------------------------------------------------------------

function buildRoiFooter(context: ProgressiveContext): string | null {
	let totalReadTokens = 0;
	let totalDiscoveryTokens = 0;

	const indexIds = new Set(context.observationIndex.map((e) => e.id));

	for (const entry of context.observationIndex) {
		totalReadTokens += entry.tokenCount;
		totalDiscoveryTokens += entry.discoveryTokens;
	}

	for (const obs of context.fullObservations) {
		if (!indexIds.has(obs.id)) {
			totalReadTokens += obs.tokenCount;
			totalDiscoveryTokens += obs.discoveryTokens;
		}
	}

	if (totalDiscoveryTokens === 0) return null;

	const savedTokens = totalDiscoveryTokens - totalReadTokens;
	const savingsPercent =
		totalDiscoveryTokens > 0 ? Math.round((savedTokens / totalDiscoveryTokens) * 100) : 0;

	return `### 💰 Memory Economics\n**Read cost:** ~${totalReadTokens}t | **Discovery cost:** ~${totalDiscoveryTokens}t | **Savings:** ${savingsPercent}% (${savedTokens}t saved)`;
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
