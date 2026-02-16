import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0";

export const observationTypeSchema = z.enum([
	"decision",
	"bugfix",
	"feature",
	"refactor",
	"discovery",
	"change",
]);

export const toolSchemas = {
	find: z.object({
		query: z.string().min(1),
		scope: z.enum(["project", "user", "all"]).optional().default("project"),
		types: z.array(observationTypeSchema).optional(),
		limit: z.number().int().min(1).max(50).optional().default(10),
		cursor: z.string().optional(),
		include: z
			.object({
				snippets: z.boolean().optional(),
				scores: z.boolean().optional(),
				relations: z.boolean().optional(),
			})
			.optional(),
	}),
	history: z.object({
		limit: z.number().int().min(1).max(20).optional().default(5),
		cursor: z.string().optional(),
		sessionId: z.string().optional(),
		anchor: z.string().optional().describe("Observation ID to center the timeline around"),
		depthBefore: z.number().int().min(0).max(20).optional().default(5),
		depthAfter: z.number().int().min(0).max(20).optional().default(5),
	}),
	get: z.object({
		ids: z.array(z.string()).min(1),
		includeHistory: z.boolean().optional().default(false),
		limit: z.number().int().min(1).max(50).optional().default(10),
	}),
	create: z.object({
		title: z.string(),
		type: observationTypeSchema,
		narrative: z.string(),
		concepts: z.array(z.string()).optional(),
		files: z.array(z.string()).optional(),
		importance: z.number().int().min(1).max(5).optional(),
		scope: z.enum(["project", "user"]).optional().default("project"),
	}),
	revise: z.object({
		id: z.string(),
		title: z.string().optional(),
		narrative: z.string().optional(),
		type: observationTypeSchema.optional(),
		concepts: z.array(z.string()).optional(),
		importance: z.number().int().min(1).max(5).optional(),
		reason: z.string().optional(),
	}),
	remove: z.object({
		id: z.string(),
		reason: z.string().optional(),
	}),
	transferExport: z.object({
		scope: z.enum(["project"]).optional().default("project"),
		type: observationTypeSchema.optional(),
		limit: z.number().int().min(1).optional(),
		format: z.enum(["json"]).optional().default("json"),
	}),
	transferImport: z.object({
		payload: z.string(),
		mode: z.enum(["skip", "merge", "replace"]).optional().default("skip"),
	}),
	maintenance: z.object({
		action: z.enum([
			"folderContextDryRun",
			"folderContextClean",
			"folderContextRebuild",
			"folderContextPurge",
		]),
	}),
	help: z.object({}),
};

export type ToolSchemaName = keyof typeof toolSchemas;

export interface ToolContractMetadata {
	name: string;
	schema: ToolSchemaName;
	description: string;
	deprecated?: boolean;
	deprecationMessage?: string;
	replacement?: string;
}

export const TOOL_CONTRACTS: ToolContractMetadata[] = [
	{
		name: "mem-find",
		schema: "find",
		description:
			"Search past memories — decisions, discoveries, gotchas, and session history. Use to recall context from previous sessions before starting work.",
	},
	{
		name: "mem-history",
		schema: "history",
		description:
			"Browse session timeline and summaries. Use to understand what happened in recent sessions or drill into a specific session.",
	},
	{
		name: "mem-get",
		schema: "get",
		description:
			"Fetch full memory details by ID. Use after mem-find or mem-history to get complete narratives, facts, and file lists.",
	},
	{
		name: "mem-create",
		schema: "create",
		description:
			"Save an important observation to memory. Use for decisions + rationale, non-obvious gotchas, user preferences, or cross-session plans that auto-capture wouldn't understand the significance of.",
	},
	{
		name: "mem-revise",
		schema: "revise",
		description:
			"Update an existing memory with a new revision. Use when a previous decision changed, a gotcha was resolved, or information became outdated.",
	},
	{
		name: "mem-remove",
		schema: "remove",
		description:
			"Tombstone an obsolete or incorrect memory. Use to clean up memories that are no longer accurate or relevant.",
	},
	{
		name: "mem-export",
		schema: "transferExport",
		description:
			"Export project memories as portable JSON for backup or transfer between machines.",
	},
	{
		name: "mem-import",
		schema: "transferImport",
		description: "Import memories from a JSON export. Skips duplicates by default.",
	},
	{
		name: "mem-maintenance",
		schema: "maintenance",
		description:
			"Run folder context maintenance — clean, rebuild, purge, or dry-run AGENTS.md files.",
	},
	{
		name: "mem-help",
		schema: "help",
		description:
			"Show detailed memory workflow guidance including when to save, what to save, and memory type reference.",
	},
];

export function getToolContractByName(name: string): ToolContractMetadata | null {
	return TOOL_CONTRACTS.find((tool) => tool.name === name) ?? null;
}
