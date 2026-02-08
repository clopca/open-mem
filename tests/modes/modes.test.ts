import { beforeEach, describe, expect, test } from "bun:test";
import { buildCompressionPrompt, buildEntityExtractionPrompt } from "../../src/ai/prompts";
import {
	_resetModeCache,
	getAvailableModes,
	getDefaultMode,
	loadMode,
} from "../../src/modes/loader";

describe("Workflow Modes", () => {
	beforeEach(() => {
		_resetModeCache();
	});

	test("loadMode('code') returns valid ModeConfig with all 6 observation types", () => {
		const mode = loadMode("code");

		expect(mode.id).toBe("code");
		expect(mode.name).toBe("Code");
		expect(mode.observationTypes).toEqual([
			"decision",
			"bugfix",
			"feature",
			"refactor",
			"discovery",
			"change",
		]);
		expect(mode.conceptVocabulary.length).toBeGreaterThan(0);
		expect(mode.entityTypes.length).toBeGreaterThan(0);
		expect(mode.relationshipTypes.length).toBeGreaterThan(0);
	});

	test("loadMode('research') returns valid ModeConfig with research-specific types", () => {
		const mode = loadMode("research");

		expect(mode.id).toBe("research");
		expect(mode.name).toBe("Research");
		expect(mode.observationTypes).toContain("hypothesis");
		expect(mode.observationTypes).toContain("finding");
		expect(mode.observationTypes).toContain("methodology");
		expect(mode.entityTypes).toContain("paper");
		expect(mode.entityTypes).toContain("dataset");
		expect(mode.relationshipTypes).toContain("cites");
		expect(mode.relationshipTypes).toContain("contradicts");
		expect(mode.relationshipTypes).toContain("supports");
	});

	test("loadMode('nonexistent') falls back to code mode", () => {
		const mode = loadMode("nonexistent");

		expect(mode.id).toBe("code");
		expect(mode.observationTypes).toEqual([
			"decision",
			"bugfix",
			"feature",
			"refactor",
			"discovery",
			"change",
		]);
	});

	test("getAvailableModes() returns ['code', 'research']", () => {
		const modes = getAvailableModes();

		expect(modes).toEqual(["code", "research"]);
	});

	test("getDefaultMode() returns code mode", () => {
		const mode = getDefaultMode();

		expect(mode.id).toBe("code");
	});

	test("buildCompressionPrompt with code mode produces same output types as without mode", () => {
		const codeMode = loadMode("code");

		const withoutMode = buildCompressionPrompt("Read", "test output");
		const withCodeMode = buildCompressionPrompt("Read", "test output", undefined, codeMode);

		expect(withoutMode).toContain("decision|bugfix|feature|refactor|discovery|change");
		expect(withCodeMode).toContain("decision|bugfix|feature|refactor|discovery|change");

		expect(withoutMode).toContain("how-it-works");
		expect(withCodeMode).toContain("how-it-works");
	});

	test("buildCompressionPrompt with research mode includes hypothesis and finding types", () => {
		const researchMode = loadMode("research");

		const prompt = buildCompressionPrompt("Read", "test output", undefined, researchMode);

		expect(prompt).toContain("hypothesis");
		expect(prompt).toContain("finding");
		expect(prompt).toContain("methodology");
		expect(prompt).not.toContain("bugfix");
		expect(prompt).not.toContain("refactor");
	});

	test("buildEntityExtractionPrompt with research mode uses research entity/relationship types", () => {
		const researchMode = loadMode("research");

		const prompt = buildEntityExtractionPrompt(
			{
				title: "Test",
				type: "discovery",
				narrative: "Found something",
				facts: ["fact1"],
				concepts: ["concept1"],
				filesRead: [],
				filesModified: [],
			},
			researchMode,
		);

		expect(prompt).toContain("paper");
		expect(prompt).toContain("dataset");
		expect(prompt).toContain("cites");
		expect(prompt).toContain("contradicts");
	});

	test("buildEntityExtractionPrompt without mode uses default entity types", () => {
		const prompt = buildEntityExtractionPrompt({
			title: "Test",
			type: "discovery",
			narrative: "Found something",
			facts: ["fact1"],
			concepts: ["concept1"],
			filesRead: [],
			filesModified: [],
		});

		expect(prompt).toContain("technology, library, pattern, concept, file, person, project, other");
		expect(prompt).toContain(
			"uses, depends_on, implements, extends, related_to, replaces, configures",
		);
	});
});
