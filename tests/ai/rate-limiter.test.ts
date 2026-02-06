import { beforeEach, describe, expect, test } from "bun:test";
import { enforceRateLimit, resetRateLimiter } from "../../src/ai/rate-limiter";

beforeEach(() => {
	resetRateLimiter();
});

describe("enforceRateLimit", () => {
	test("no-op when disabled", async () => {
		const start = Date.now();
		await enforceRateLimit("gemini-2.5-flash-lite", false);
		await enforceRateLimit("gemini-2.5-flash-lite", false);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});

	test("waits when called too quickly", async () => {
		// gemini-2.0-flash-lite: 30 RPM → ceil(60000/30) + 100 = 2100ms minimum delay
		const start1 = Date.now();
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		const elapsed1 = Date.now() - start1;
		expect(elapsed1).toBeLessThan(50);

		const start2 = Date.now();
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		const elapsed2 = Date.now() - start2;
		expect(elapsed2).toBeGreaterThanOrEqual(1900);
	});

	test("does not wait when enough time has passed", async () => {
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		resetRateLimiter();

		const start = Date.now();
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});

	test("uses conservative default for unknown models", async () => {
		const start = Date.now();
		await enforceRateLimit("unknown-model", true);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});
});

describe("resetRateLimiter", () => {
	test("clears state so next call is instant", async () => {
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		resetRateLimiter();

		const start = Date.now();
		await enforceRateLimit("gemini-2.0-flash-lite", true);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeLessThan(50);
	});
});
