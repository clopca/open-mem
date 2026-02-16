import { describe, expect, test } from "bun:test";
import { InMemorySearchStrategyRegistry } from "../../src/search/registry";

describe("InMemorySearchStrategyRegistry", () => {
	test("registers and retrieves strategy executors", async () => {
		const registry = new InMemorySearchStrategyRegistry<{ limit?: number }>();
		registry.register("custom", (_options, context) => [
			{
				observation: {
					id: "x",
					sessionId: "s",
					type: "discovery",
					title: "Custom",
					subtitle: "",
					facts: [],
					narrative: "n",
					concepts: [],
					filesRead: [],
					filesModified: [],
					rawToolOutput: "",
					toolName: "tool",
					createdAt: new Date().toISOString(),
					tokenCount: 1,
					discoveryTokens: 1,
					importance: 3,
				},
				rank: context.limit,
				snippet: "snippet",
				rankingSource: "fts",
			},
		]);

		const executor = registry.get("custom");
		expect(executor).not.toBeNull();
		const results = await executor!({}, { query: "q", limit: 5 });
		expect(results[0].observation.id).toBe("x");
		expect(results[0].rank).toBe(5);
	});
});
