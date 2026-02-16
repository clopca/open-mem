import { describe, expect, test } from "bun:test";
import { CONTRACT_VERSION, TOOL_CONTRACTS, toolSchemas } from "../../src/contracts/schemas";

describe("Contract schemas", () => {
	test("exports a non-empty contract version", () => {
		expect(CONTRACT_VERSION.length).toBeGreaterThan(0);
	});

	test("tool contracts map to existing schemas", () => {
		for (const tool of TOOL_CONTRACTS) {
			expect(tool.name.startsWith("mem-")).toBe(true);
			expect(toolSchemas[tool.schema]).toBeDefined();
		}
	});
});
