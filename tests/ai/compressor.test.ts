// =============================================================================
// open-mem — AI Compressor Tests (Task 10)
// =============================================================================

import { describe, expect, test } from "bun:test";
import { ObservationCompressor } from "../../src/ai/compressor";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ConstructorParameters<typeof ObservationCompressor>[0]>) {
	return {
		provider: "anthropic",
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		maxTokensPerCompression: 1024,
		compressionEnabled: true,
		minOutputLength: 50,
		rateLimitingEnabled: false,
		...overrides,
	};
}

/** Inject a fake _generate function into the compressor */
function withMockGenerate(
	compressor: ObservationCompressor,
	fn: (...args: unknown[]) => unknown,
): void {
	(compressor as unknown as Record<string, unknown>)._generate = fn;
}

const VALID_OBSERVATION_XML = `<observation>
  <type>discovery</type>
  <title>Found auth pattern</title>
  <subtitle>JWT-based</subtitle>
  <facts><fact>Uses RS256</fact></facts>
  <narrative>The auth module uses JWT.</narrative>
  <concepts><concept>JWT</concept></concepts>
  <files_read><file>src/auth.ts</file></files_read>
  <files_modified></files_modified>
</observation>`;

// =============================================================================
// Tests
// =============================================================================

describe("ObservationCompressor", () => {
	test("compress returns null when disabled", async () => {
		const compressor = new ObservationCompressor(makeConfig({ compressionEnabled: false }));
		const result = await compressor.compress("Read", "a".repeat(100));
		expect(result).toBeNull();
	});

	test("compress returns null for short output", async () => {
		const compressor = new ObservationCompressor(makeConfig());
		withMockGenerate(compressor, () => {
			throw new Error("should not be called");
		});
		const result = await compressor.compress("Read", "short");
		expect(result).toBeNull();
	});

	test("compress truncates very long output", async () => {
		let capturedPrompt = "";
		const compressor = new ObservationCompressor(makeConfig());
		withMockGenerate(compressor, (...args: unknown[]) => {
			const opts = args[0] as Record<string, unknown>;
			capturedPrompt = opts.prompt as string;
			return Promise.resolve({ text: VALID_OBSERVATION_XML });
		});

		const longOutput = "x".repeat(60_000);
		await compressor.compress("Read", longOutput);
		expect(capturedPrompt).toContain("[... truncated ...]");
		expect(capturedPrompt.length).toBeLessThan(longOutput.length);
	});

	test("compress calls API and parses response", async () => {
		const compressor = new ObservationCompressor(makeConfig());
		withMockGenerate(compressor, () => Promise.resolve({ text: VALID_OBSERVATION_XML }));

		const result = await compressor.compress("Read", "a".repeat(100));
		expect(result).not.toBeNull();
		expect(result?.type).toBe("discovery");
		expect(result?.title).toBe("Found auth pattern");
	});

	test("compress handles API error gracefully", async () => {
		const compressor = new ObservationCompressor(makeConfig());
		withMockGenerate(compressor, () => Promise.reject(new Error("network error")));

		const result = await compressor.compress("Read", "a".repeat(100));
		expect(result).toBeNull();
	});

	test("compress handles unparseable response", async () => {
		const compressor = new ObservationCompressor(makeConfig());
		withMockGenerate(compressor, () => Promise.resolve({ text: "not valid xml at all" }));

		const result = await compressor.compress("Read", "a".repeat(100));
		expect(result).toBeNull();
	});

	test("createFallbackObservation for Read tool", () => {
		const compressor = new ObservationCompressor(makeConfig({ compressionEnabled: false }));
		const fallback = compressor.createFallbackObservation(
			"Read",
			"Contents of src/auth.ts:\nexport function login() {}",
		);
		expect(fallback.type).toBe("discovery");
		expect(fallback.title).toBe("Read execution");
	});

	test("createFallbackObservation for Write tool", () => {
		const compressor = new ObservationCompressor(makeConfig({ compressionEnabled: false }));
		const fallback = compressor.createFallbackObservation("Write", "Wrote to src/auth.ts");
		expect(fallback.type).toBe("change");
	});

	test("createFallbackObservation extracts file paths", () => {
		const compressor = new ObservationCompressor(makeConfig({ compressionEnabled: false }));
		const fallback = compressor.createFallbackObservation(
			"Read",
			"Reading src/auth.ts and src/middleware.ts for analysis",
		);
		expect(fallback.filesRead).toContain("src/auth.ts");
		expect(fallback.filesRead).toContain("src/middleware.ts");
	});

	test("compressBatch processes items and returns map", async () => {
		const compressor = new ObservationCompressor(makeConfig());
		let callCount = 0;
		withMockGenerate(compressor, () => {
			callCount++;
			return Promise.resolve({ text: VALID_OBSERVATION_XML });
		});

		const results = await compressor.compressBatch([
			{
				toolName: "Read",
				toolOutput: "a".repeat(100),
				callId: "call-1",
			},
			{
				toolName: "Bash",
				toolOutput: "b".repeat(100),
				callId: "call-2",
			},
		]);

		expect(results.size).toBe(2);
		expect(results.get("call-1")).not.toBeNull();
		expect(results.get("call-2")).not.toBeNull();
		expect(callCount).toBe(2);
	});
});
