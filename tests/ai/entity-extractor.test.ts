import { describe, expect, test } from "bun:test";
import { EntityExtractor } from "../../src/ai/entity-extractor";
import type { EntityExtractionObservation } from "../../src/ai/entity-extractor";

function makeConfig(overrides?: Partial<ConstructorParameters<typeof EntityExtractor>[0]>) {
	return {
		provider: "anthropic",
		apiKey: "test-key",
		model: "claude-sonnet-4-20250514",
		rateLimitingEnabled: false,
		...overrides,
	};
}

function withMockGenerate(
	extractor: EntityExtractor,
	fn: (...args: unknown[]) => unknown,
): void {
	(extractor as unknown as Record<string, unknown>)._generate = fn;
}

const OBSERVATION: EntityExtractionObservation = {
	title: "Configured React with TypeScript",
	type: "discovery",
	narrative: "The project uses React 18 with TypeScript and Vite as the build tool.",
	facts: ["React 18 is used", "TypeScript is the language", "Vite handles bundling"],
	concepts: ["react", "typescript", "vite"],
	filesRead: ["package.json", "vite.config.ts"],
	filesModified: [],
};

const VALID_EXTRACTION_XML = `<extraction>
  <entities>
    <entity><name>React</name><type>library</type></entity>
    <entity><name>TypeScript</name><type>technology</type></entity>
    <entity><name>Vite</name><type>technology</type></entity>
    <entity><name>package.json</name><type>file</type></entity>
  </entities>
  <relations>
    <relation><source>React</source><relationship>uses</relationship><target>TypeScript</target></relation>
    <relation><source>Vite</source><relationship>configures</relationship><target>React</target></relation>
  </relations>
</extraction>`;

const EMPTY_EXTRACTION_XML = `<extraction>
  <entities></entities>
  <relations></relations>
</extraction>`;

describe("EntityExtractor", () => {
	test("entities extracted correctly from mock LLM response", async () => {
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: VALID_EXTRACTION_XML }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.entities).toHaveLength(4);
		expect(result!.entities[0]).toEqual({ name: "React", entityType: "library" });
		expect(result!.entities[1]).toEqual({ name: "TypeScript", entityType: "technology" });
		expect(result!.entities[2]).toEqual({ name: "Vite", entityType: "technology" });
		expect(result!.entities[3]).toEqual({ name: "package.json", entityType: "file" });
	});

	test("relations extracted correctly", async () => {
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: VALID_EXTRACTION_XML }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.relations).toHaveLength(2);
		expect(result!.relations[0]).toEqual({
			sourceName: "React",
			targetName: "TypeScript",
			relationship: "uses",
		});
		expect(result!.relations[1]).toEqual({
			sourceName: "Vite",
			targetName: "React",
			relationship: "configures",
		});
	});

	test("null returned on LLM failure", async () => {
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.reject(new Error("network error")));

		const result = await extractor.extract(OBSERVATION);
		expect(result).toBeNull();
	});

	test("null returned on invalid response", async () => {
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: "not valid xml at all" }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).toBeNull();
	});

	test("invalid entity type falls back to 'other'", async () => {
		const xml = `<extraction>
  <entities>
    <entity><name>Foo</name><type>unknown_type</type></entity>
    <entity><name>Bar</name><type>LIBRARY</type></entity>
  </entities>
  <relations></relations>
</extraction>`;
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: xml }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.entities[0]).toEqual({ name: "Foo", entityType: "other" });
		expect(result!.entities[1]).toEqual({ name: "Bar", entityType: "library" });
	});

	test("invalid relationship type is skipped", async () => {
		const xml = `<extraction>
  <entities>
    <entity><name>A</name><type>concept</type></entity>
    <entity><name>B</name><type>concept</type></entity>
  </entities>
  <relations>
    <relation><source>A</source><relationship>invalid_rel</relationship><target>B</target></relation>
    <relation><source>A</source><relationship>uses</relationship><target>B</target></relation>
  </relations>
</extraction>`;
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: xml }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.relations).toHaveLength(1);
		expect(result!.relations[0].relationship).toBe("uses");
	});

	test("empty extraction returns empty arrays", async () => {
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: EMPTY_EXTRACTION_XML }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.entities).toHaveLength(0);
		expect(result!.relations).toHaveLength(0);
	});

	test("null returned when model unavailable", async () => {
		const extractor = new EntityExtractor(makeConfig({ apiKey: undefined }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).toBeNull();
	});

	test("prompt includes observation fields", async () => {
		let capturedPrompt = "";
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, (...args: unknown[]) => {
			const opts = args[0] as Record<string, unknown>;
			capturedPrompt = opts.prompt as string;
			return Promise.resolve({ text: VALID_EXTRACTION_XML });
		});

		await extractor.extract(OBSERVATION);

		expect(capturedPrompt).toContain("Configured React with TypeScript");
		expect(capturedPrompt).toContain("React 18 with TypeScript and Vite");
		expect(capturedPrompt).toContain("package.json");
		expect(capturedPrompt).toContain("vite.config.ts");
		expect(capturedPrompt).toContain("react");
		expect(capturedPrompt).toContain("technology");
		expect(capturedPrompt).toContain("library");
		expect(capturedPrompt).toContain("uses");
		expect(capturedPrompt).toContain("depends_on");
	});

	test("entities without name are skipped", async () => {
		const xml = `<extraction>
  <entities>
    <entity><name></name><type>library</type></entity>
    <entity><name>Valid</name><type>concept</type></entity>
  </entities>
  <relations></relations>
</extraction>`;
		const extractor = new EntityExtractor(makeConfig());
		withMockGenerate(extractor, () => Promise.resolve({ text: xml }));

		const result = await extractor.extract(OBSERVATION);
		expect(result).not.toBeNull();
		expect(result!.entities).toHaveLength(1);
		expect(result!.entities[0].name).toBe("Valid");
	});
});
