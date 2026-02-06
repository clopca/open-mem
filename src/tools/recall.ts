// =============================================================================
// open-mem — mem-recall Custom Tool
// =============================================================================

import { z } from "zod";
import type { ObservationRepository } from "../db/observations";
import type { Observation, ToolDefinition } from "../types";

export function createRecallTool(observations: ObservationRepository): ToolDefinition {
	return {
		name: "mem-recall",
		description:
			"Fetch full observation details by ID. Use after mem-search to get complete narratives, facts, concepts, and file lists for specific observations.",
		args: {
			ids: z.array(z.string()).describe("Observation IDs to fetch"),
			limit: z.number().min(1).max(50).default(10).describe("Maximum number of results"),
		},
		execute: async (args) => {
			try {
				const ids = args.ids as string[];
				const limit = (args.limit as number) || 10;

				const idsToFetch = ids.slice(0, limit);
				const results: string[] = [];

				for (const id of idsToFetch) {
					const obs = observations.getById(id);
					if (obs) {
						results.push(formatObservation(obs));
					} else {
						results.push(`## ID: ${id}\n*Not found*`);
					}
				}

				if (results.length === 0) {
					return "No observation IDs provided.";
				}

				return `Recalled ${results.length} observation(s):\n\n${results.join("\n---\n")}`;
			} catch (error) {
				return `Recall error: ${error}`;
			}
		},
	};
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

function formatObservation(obs: Observation): string {
	const lines: string[] = [];

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
	if (obs.filesRead.length > 0) {
		lines.push(`**Files read:** ${obs.filesRead.join(", ")}`);
	}
	if (obs.filesModified.length > 0) {
		lines.push(`**Files modified:** ${obs.filesModified.join(", ")}`);
	}

	lines.push(`\n*ID: ${obs.id} | Created: ${obs.createdAt} | Tokens: ${obs.tokenCount}*`);

	return lines.join("\n");
}
