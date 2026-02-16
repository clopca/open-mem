import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ModeResolverV2 } from "../../src/modes/resolver";

const tempDirs: string[] = [];

function mkTempDir(): string {
	const dir = `/tmp/open-mem-mode-resolver-${randomUUID()}`;
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("ModeResolverV2", () => {
	test("resolves inheritance using extends", () => {
		const dir = mkTempDir();
		writeFileSync(
			join(dir, "base.json"),
			JSON.stringify({
				id: "base",
				name: "Base",
				description: "base",
				observationTypes: ["decision"],
				conceptVocabulary: ["pattern"],
				entityTypes: ["project"],
				relationshipTypes: ["related_to"],
			}),
		);
		writeFileSync(
			join(dir, "child.json"),
			JSON.stringify({
				id: "child",
				extends: "base",
				name: "Child",
				description: "child",
				observationTypes: ["feature"],
				conceptVocabulary: ["what-changed"],
				entityTypes: ["file"],
				relationshipTypes: ["uses"],
				promptOverrides: { language: "es" },
			}),
		);

		const resolver = new ModeResolverV2(dir);
		const raw = resolver.loadAllRaw();
		const resolved = resolver.resolveById("child", raw);
		expect(resolved.id).toBe("child");
		expect(resolved.observationTypes).toEqual(["feature"]);
		expect(resolved.promptOverrides?.language).toBe("es");
	});

	test("falls back safely on cyclic extends", () => {
		const dir = mkTempDir();
		writeFileSync(
			join(dir, "a.json"),
			JSON.stringify({
				id: "a",
				extends: "b",
				name: "A",
				description: "A",
				observationTypes: ["feature"],
				conceptVocabulary: ["pattern"],
				entityTypes: ["file"],
				relationshipTypes: ["uses"],
			}),
		);
		writeFileSync(
			join(dir, "b.json"),
			JSON.stringify({
				id: "b",
				extends: "a",
				name: "B",
				description: "B",
				observationTypes: ["decision"],
				conceptVocabulary: ["trade-off"],
				entityTypes: ["project"],
				relationshipTypes: ["depends_on"],
			}),
		);

		const resolver = new ModeResolverV2(dir);
		const raw = resolver.loadAllRaw();
		const resolved = resolver.resolveById("a", raw);
		expect(resolved.id).toBe("code");
	});
});
