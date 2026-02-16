import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeConfig } from "../types";

const DEFAULT_MODE: ModeConfig = {
	id: "code",
	name: "Code",
	description: "Default coding workflow mode",
	observationTypes: ["decision", "bugfix", "feature", "refactor", "discovery", "change"],
	conceptVocabulary: [
		"how-it-works",
		"why-it-exists",
		"what-changed",
		"problem-solution",
		"gotcha",
		"pattern",
		"trade-off",
	],
	entityTypes: [
		"technology",
		"library",
		"pattern",
		"concept",
		"file",
		"person",
		"project",
		"other",
	],
	relationshipTypes: [
		"uses",
		"depends_on",
		"implements",
		"extends",
		"related_to",
		"replaces",
		"configures",
	],
};

function isValidMode(value: unknown): value is ModeConfig {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	const isStringArray = (x: unknown) =>
		Array.isArray(x) && x.every((item) => typeof item === "string");
	return (
		typeof v.id === "string" &&
		typeof v.name === "string" &&
		typeof v.description === "string" &&
		isStringArray(v.observationTypes) &&
		isStringArray(v.conceptVocabulary) &&
		isStringArray(v.entityTypes) &&
		isStringArray(v.relationshipTypes)
	);
}

function mergeMode(base: ModeConfig, override: ModeConfig): ModeConfig {
	return {
		...base,
		...override,
		observationTypes: override.observationTypes ?? base.observationTypes,
		conceptVocabulary: override.conceptVocabulary ?? base.conceptVocabulary,
		entityTypes: override.entityTypes ?? base.entityTypes,
		relationshipTypes: override.relationshipTypes ?? base.relationshipTypes,
		promptOverrides: {
			...(base.promptOverrides ?? {}),
			...(override.promptOverrides ?? {}),
		},
	};
}

export class ModeResolverV2 {
	constructor(private readonly modesDir: string) {}

	loadAllRaw(): Map<string, ModeConfig> {
		const modes = new Map<string, ModeConfig>();
		if (!existsSync(this.modesDir)) return modes;

		for (const file of readdirSync(this.modesDir)) {
			if (!file.endsWith(".json")) continue;
			const path = join(this.modesDir, file);
			try {
				const raw = readFileSync(path, "utf-8");
				const parsed = JSON.parse(raw);
				if (!isValidMode(parsed)) continue;
				modes.set(parsed.id, parsed);
			} catch {
				// ignore malformed files
			}
		}
		return modes;
	}

	resolveById(id: string, rawModes: Map<string, ModeConfig>): ModeConfig {
		const seen = new Set<string>();
		let cycleDetected = false;
		const resolveInner = (modeId: string): ModeConfig => {
			if (seen.has(modeId)) {
				cycleDetected = true;
				return DEFAULT_MODE;
			}
			seen.add(modeId);
			const mode = rawModes.get(modeId);
			if (!mode) return DEFAULT_MODE;
			if (!mode.extends) return mode;
			const parent = resolveInner(mode.extends);
			if (cycleDetected) return DEFAULT_MODE;
			return mergeMode(parent, mode);
		};
		const resolved = resolveInner(id);
		return cycleDetected ? DEFAULT_MODE : resolved;
	}
}

export function getDefaultModeConfig(): ModeConfig {
	return DEFAULT_MODE;
}
