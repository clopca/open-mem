import { z } from "zod";

export const observationTypeSchema = z.enum([
	"decision",
	"bugfix",
	"feature",
	"refactor",
	"discovery",
	"change",
]);

export type ApiErrorCode =
	| "VALIDATION_ERROR"
	| "NOT_FOUND"
	| "CONFLICT"
	| "LOCKED_BY_ENV"
	| "INTERNAL_ERROR";

export interface ApiEnvelope<T> {
	data: T | null;
	error: null | { code: ApiErrorCode; message: string; details?: unknown };
	meta: Record<string, unknown>;
}

export function ok<T>(data: T, meta: Record<string, unknown> = {}): ApiEnvelope<T> {
	return { data, error: null, meta };
}

export function fail(code: ApiErrorCode, message: string, details?: unknown): ApiEnvelope<null> {
	return {
		data: null,
		error: { code, message, details },
		meta: {},
	};
}

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
		action: z.enum(["folderContextDryRun", "folderContextClean", "folderContextRebuild"]),
	}),
	help: z.object({}),
};
