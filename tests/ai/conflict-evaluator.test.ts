import { describe, expect, test } from "bun:test";
import { ConflictEvaluator } from "../../src/ai/conflict-evaluator";
import type { ConflictCandidate, ConflictNewObservation } from "../../src/ai/conflict-evaluator";

function makeConfig(overrides?: Partial<ConstructorParameters<typeof ConflictEvaluator>[0]>) {
	return {
		provider: "anthropic",
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		rateLimitingEnabled: false,
		...overrides,
	};
}

function withMockGenerate(
	evaluator: ConflictEvaluator,
	fn: (...args: unknown[]) => unknown,
): void {
	(evaluator as unknown as Record<string, unknown>)._generate = fn;
}

const NEW_OBS: ConflictNewObservation = {
	title: "Auth uses JWT tokens",
	narrative: "The authentication module uses JWT with RS256 signing.",
	concepts: ["JWT", "auth"],
	type: "discovery",
};

const CANDIDATES: ConflictCandidate[] = [
	{
		id: "obs-001",
		title: "Auth uses session cookies",
		narrative: "The authentication module uses session cookies for state management.",
		concepts: ["auth", "cookies"],
		type: "discovery",
	},
	{
		id: "obs-002",
		title: "Database uses PostgreSQL",
		narrative: "The project uses PostgreSQL as the primary database.",
		concepts: ["database", "postgresql"],
		type: "discovery",
	},
];

const NEW_FACT_XML = `<evaluation>
  <outcome>new_fact</outcome>
  <supersedes></supersedes>
  <reason>JWT token usage is new information not covered by existing candidates.</reason>
</evaluation>`;

const UPDATE_XML = `<evaluation>
  <outcome>update</outcome>
  <supersedes>obs-001</supersedes>
  <reason>The new observation supersedes the session cookies observation — auth now uses JWT.</reason>
</evaluation>`;

const DUPLICATE_XML = `<evaluation>
  <outcome>duplicate</outcome>
  <supersedes></supersedes>
  <reason>This information is already captured in the existing observation.</reason>
</evaluation>`;

describe("ConflictEvaluator", () => {
	test("new_fact outcome parsed correctly", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => Promise.resolve({ text: NEW_FACT_XML }));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).not.toBeNull();
		expect(result!.outcome).toBe("new_fact");
		expect(result!.reason).toContain("new information");
		expect(result!.supersedesId).toBeUndefined();
	});

	test("update outcome includes supersedesId", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => Promise.resolve({ text: UPDATE_XML }));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).not.toBeNull();
		expect(result!.outcome).toBe("update");
		expect(result!.supersedesId).toBe("obs-001");
		expect(result!.reason).toContain("supersedes");
	});

	test("duplicate outcome parsed correctly", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => Promise.resolve({ text: DUPLICATE_XML }));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).not.toBeNull();
		expect(result!.outcome).toBe("duplicate");
		expect(result!.supersedesId).toBeUndefined();
	});

	test("null returned on LLM failure", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => Promise.reject(new Error("network error")));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).toBeNull();
	});

	test("null returned on invalid response", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => Promise.resolve({ text: "not valid xml at all" }));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).toBeNull();
	});

	test("null returned on invalid outcome value", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () =>
			Promise.resolve({
				text: `<evaluation><outcome>invalid_value</outcome><reason>test</reason></evaluation>`,
			}),
		);

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).toBeNull();
	});

	test("null returned when no candidates", async () => {
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, () => {
			throw new Error("should not be called");
		});

		const result = await evaluator.evaluate(NEW_OBS, []);
		expect(result).toBeNull();
	});

	test("null returned when model unavailable", async () => {
		const evaluator = new ConflictEvaluator(makeConfig({ apiKey: undefined }));

		const result = await evaluator.evaluate(NEW_OBS, CANDIDATES);
		expect(result).toBeNull();
	});

	test("prompt includes all candidate info", async () => {
		let capturedPrompt = "";
		const evaluator = new ConflictEvaluator(makeConfig());
		withMockGenerate(evaluator, (...args: unknown[]) => {
			const opts = args[0] as Record<string, unknown>;
			capturedPrompt = opts.prompt as string;
			return Promise.resolve({ text: NEW_FACT_XML });
		});

		await evaluator.evaluate(NEW_OBS, CANDIDATES);

		expect(capturedPrompt).toContain("Auth uses JWT tokens");
		expect(capturedPrompt).toContain("JWT with RS256");
		expect(capturedPrompt).toContain("obs-001");
		expect(capturedPrompt).toContain("Auth uses session cookies");
		expect(capturedPrompt).toContain("obs-002");
		expect(capturedPrompt).toContain("Database uses PostgreSQL");
		expect(capturedPrompt).toContain("new_fact");
		expect(capturedPrompt).toContain("update");
		expect(capturedPrompt).toContain("duplicate");
	});
});
