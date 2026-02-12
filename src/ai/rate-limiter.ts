// =============================================================================
// open-mem — Rate Limiter for Gemini Free Tier
// =============================================================================

// Rate limits for Gemini free tier (requests per minute)
const GEMINI_RPM_LIMITS: Record<string, number> = {
	"gemini-2.5-flash-lite": 10,
	"gemini-2.5-flash": 10,
	"gemini-2.5-pro": 5,
	"gemini-2.0-flash": 15,
	"gemini-2.0-flash-lite": 30,
	"gemini-3-flash": 5,
};

let lastRequestTime = 0;

/**
 * Enforce RPM rate limit for Gemini free tier.
 * Waits the minimum delay between requests: (60s / RPM) + 100ms safety buffer.
 * No-op if rate limiting is disabled.
 */
export async function enforceRateLimit(model: string, enabled: boolean): Promise<void> {
	if (!enabled) return;

	const rpm = GEMINI_RPM_LIMITS[model] || 5; // conservative default
	const minimumDelayMs = Math.ceil(60000 / rpm) + 100;

	const now = Date.now();
	const timeSinceLastRequest = now - lastRequestTime;

	if (timeSinceLastRequest < minimumDelayMs) {
		const waitTime = minimumDelayMs - timeSinceLastRequest;
		await new Promise((resolve) => setTimeout(resolve, waitTime));
	}

	lastRequestTime = Date.now();
}

/** Reset rate limiter state (for testing) */
export function resetRateLimiter(): void {
	lastRequestTime = 0;
}
