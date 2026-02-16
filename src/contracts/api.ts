export type { ToolContractName } from "./schemas";
export {
	CONTRACT_VERSION,
	getToolContractByName,
	observationTypeSchema,
	TOOL_CONTRACTS,
	toolSchemas,
} from "./schemas";

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
