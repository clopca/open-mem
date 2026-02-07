// =============================================================================
// open-mem — mem-search Custom Tool
// =============================================================================

import { z } from "zod";
import type { SummaryRepository } from "../db/summaries";
import type { SearchOrchestrator } from "../search/orchestrator";
import type { SearchResult, SessionSummary, ToolDefinition } from "../types";

const searchArgsSchema = z.object({
	query: z.string().describe("Search query (supports keywords, phrases, file paths)"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.optional()
		.describe("Filter by observation type"),
	limit: z.number().min(1).max(50).default(10).describe("Maximum number of results"),
	importance_min: z.number().min(1).max(5).optional().describe("Minimum importance (1-5)"),
	importance_max: z.number().min(1).max(5).optional().describe("Maximum importance (1-5)"),
	after: z.string().optional().describe("Only observations after this date (ISO 8601)"),
	before: z.string().optional().describe("Only observations before this date (ISO 8601)"),
	concepts: z.array(z.string()).optional().describe("Filter by concepts"),
	files: z.array(z.string()).optional().describe("Filter by file paths"),
});

type SearchArgs = z.infer<typeof searchArgsSchema>;

export function createSearchTool(
	searchOrchestrator: SearchOrchestrator,
	summaries: SummaryRepository,
	projectPath = "",
): ToolDefinition {
	return {
		name: "mem-search",
		description: `Layer 1: Quick search — returns lightweight results with observation IDs.
Search through past coding session observations and memories to find:
- Past decisions and their rationale
- Bug fixes and their solutions
- Code patterns and discoveries
- File modification history
- Concept-based knowledge retrieval

Results include observation IDs. For full details on any result, use mem-recall with the observation ID.
Supports full-text search with FTS5 and optional vector similarity.`,
		args: searchArgsSchema.shape,
		execute: async (rawArgs) => {
			try {
				const args: SearchArgs = searchArgsSchema.parse(rawArgs);

				const results = await searchOrchestrator.search(args.query, {
					type: args.type,
					limit: args.limit,
					projectPath,
					importanceMin: args.importance_min,
					importanceMax: args.importance_max,
					createdAfter: args.after,
					createdBefore: args.before,
					concepts: args.concepts,
					files: args.files,
				});

				if (results.length === 0) {
					const summaryResults = summaries.search(args.query, args.limit);
					if (summaryResults.length === 0) {
						return "No matching observations or session summaries found.";
					}
					return formatSummaryResults(summaryResults);
				}

				return formatSearchResults(results);
			} catch (error) {
				return `Search error: ${error}`;
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatSearchResults(results: SearchResult[]): string {
	const lines: string[] = [`Found ${results.length} observation(s):\n`];

	for (const result of results) {
		const { observation: obs, source } = result;
		const sourceLabel = source === "user" ? " [USER]" : "";
		lines.push(`## [${obs.type.toUpperCase()}]${sourceLabel} ${obs.title}`);
		lines.push(`**ID:** \`${obs.id}\``);
		if (obs.subtitle) lines.push(`*${obs.subtitle}*`);
		lines.push(`\n${obs.narrative}`);

		if (obs.facts.length > 0) {
			lines.push("\n**Facts:**");
			for (const f of obs.facts) lines.push(`- ${f}`);
		}
		if (obs.concepts.length > 0) {
			lines.push(`\n**Concepts:** ${obs.concepts.join(", ")}`);
		}
		if (obs.filesModified.length > 0) {
			lines.push(`**Files modified:** ${obs.filesModified.join(", ")}`);
		}
		if (obs.filesRead.length > 0) {
			lines.push(`**Files read:** ${obs.filesRead.join(", ")}`);
		}

		lines.push(`\n*Session: ${obs.sessionId} | ${obs.createdAt}*`);
		lines.push("---");
	}

	lines.push("\n💡 Use `mem-recall` with observation IDs above to get full details.");

	return lines.join("\n");
}

function formatSummaryResults(results: SessionSummary[]): string {
	const lines: string[] = [`Found ${results.length} session summary(ies):\n`];

	for (const summary of results) {
		lines.push(`## Session: ${summary.sessionId}`);
		lines.push(summary.summary);
		if (summary.keyDecisions.length > 0) {
			lines.push("\n**Key decisions:**");
			for (const d of summary.keyDecisions) lines.push(`- ${d}`);
		}
		lines.push("---");
	}

	return lines.join("\n");
}
