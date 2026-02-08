// =============================================================================
// open-mem — Shared AI Error Handling Utilities
// =============================================================================

/**
 * Check if an error is retryable (429/500/503 or overloaded).
 */
export function isRetryable(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const err = error as Record<string, unknown>;
	const status = err.status;
	if (status === 429 || status === 500 || status === 503) return true;
	const errObj = err.error;
	if (
		typeof errObj === "object" &&
		errObj !== null &&
		(errObj as Record<string, unknown>).type === "overloaded_error"
	) {
		return true;
	}
	return false;
}

/**
 * Check if an error is a config error that should NOT trigger fallback.
 * Returns true for 400/401/403 errors.
 */
export function isConfigError(error: unknown): boolean {
	if (error && typeof error === "object") {
		const status = (error as Record<string, unknown>).status;
		if (typeof status === "number") {
			return status === 400 || status === 401 || status === 403;
		}
	}
	return false;
}

/**
 * Sleep utility for retry delays.
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
