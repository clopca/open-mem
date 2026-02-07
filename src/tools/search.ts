// =============================================================================
// open-mem — mem-search Custom Tool
// =============================================================================

import type { EmbeddingModel } from "ai";
import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { SummaryRepository } from "../db/summaries";
import { hybridSearch } from "../search/hybrid";
import type { SearchResult, SessionSummary, ToolDefinition } from "../types";

const searchArgsSchema = z.object({
	query: z.string().describe("Search query (supports keywords, phrases, file paths)"),
	type: z
		.enum(["decision", "bugfix", "feature", "refactor", "discovery", "change"])
		.optional()
		.describe("Filter by observation type"),
	limit: z.number().min(1).max(50).default(10).describe("Maximum number of results"),
});

type SearchArgs = z.infer<typeof searchArgsSchema>;

export function createSearchTool(
	observations: ObservationRepository,
	summaries: SummaryRepository,
	embeddingModel: EmbeddingModel | null = null,
	projectPath = "",
	hasVectorExtension = false,
): ToolDefinition {
	return {
		name: "mem-search",
		description: `Search through past coding session observations and memories.
Use this tool to find relevant context from previous sessions, including:
- Past decisions and their rationale
- Bug fixes and their solutions
- Code patterns and discoveries
- File modification history
- Concept-based knowledge retrieval

Supports full-text search with FTS5.`,
		args: searchArgsSchema.shape,
		execute: async (rawArgs) => {
			try {
				const args: SearchArgs = searchArgsSchema.parse(rawArgs);

				const results = await hybridSearch(args.query, observations, embeddingModel, {
					type: args.type,
					limit: args.limit,
					projectPath,
					hasVectorExtension,
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

	for (const { observation: obs } of results) {
		lines.push(`## [${obs.type.toUpperCase()}] ${obs.title}`);
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
