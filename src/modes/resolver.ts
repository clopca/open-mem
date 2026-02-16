import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModeConfig } from "../types";

export interface ModeConfigSource {
	id: string;
	extends?: string;
	locale?: string;
	name?: string;
	description?: string;
	observationTypes?: string[];
	conceptVocabulary?: string[];
	entityTypes?: string[];
	relationshipTypes?: string[];
	promptOverrides?: Record<string, string>;
}

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

function cloneMode(mode: ModeConfig): ModeConfig {
	return {
		...mode,
		observationTypes: [...mode.observationTypes],
		conceptVocabulary: [...mode.conceptVocabulary],
		entityTypes: [...mode.entityTypes],
		relationshipTypes: [...mode.relationshipTypes],
		promptOverrides: mode.promptOverrides ? { ...mode.promptOverrides } : undefined,
	};
}

function isValidModeSource(value: unknown): value is ModeConfigSource {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	const isStringArray = (x: unknown) =>
		Array.isArray(x) && x.every((item) => typeof item === "string");
	const isRecordOfString = (x: unknown) =>
		typeof x === "object" &&
		x !== null &&
		!Array.isArray(x) &&
		Object.values(x).every((item) => typeof item === "string");
	return (
		typeof v.id === "string" &&
		(v.extends === undefined || typeof v.extends === "string") &&
		(v.locale === undefined || typeof v.locale === "string") &&
		(v.name === undefined || typeof v.name === "string") &&
		(v.description === undefined || typeof v.description === "string") &&
		(v.observationTypes === undefined || isStringArray(v.observationTypes)) &&
		(v.conceptVocabulary === undefined || isStringArray(v.conceptVocabulary)) &&
		(v.entityTypes === undefined || isStringArray(v.entityTypes)) &&
		(v.relationshipTypes === undefined || isStringArray(v.relationshipTypes)) &&
		(v.promptOverrides === undefined || isRecordOfString(v.promptOverrides))
	);
}

function isCompleteRootMode(mode: ModeConfigSource): boolean {
	return (
		typeof mode.name === "string" &&
		typeof mode.description === "string" &&
		Array.isArray(mode.observationTypes) &&
		Array.isArray(mode.conceptVocabulary) &&
		Array.isArray(mode.entityTypes) &&
		Array.isArray(mode.relationshipTypes)
	);
}

function mergeMode(base: ModeConfig, override: ModeConfigSource): ModeConfig {
	return {
		...base,
		...override,
		id: override.id,
		name: override.name ?? base.name,
		description: override.description ?? base.description,
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

	loadAllRaw(): Map<string, ModeConfigSource> {
		const modes = new Map<string, ModeConfigSource>();
		if (!existsSync(this.modesDir)) return modes;

		for (const file of readdirSync(this.modesDir)) {
			if (!file.endsWith(".json")) continue;
			const path = join(this.modesDir, file);
			try {
				const raw = readFileSync(path, "utf-8");
				const parsed = JSON.parse(raw);
				if (!isValidModeSource(parsed)) continue;
				if (modes.has(parsed.id)) {
					console.warn(
						`[open-mem] Duplicate mode id "${parsed.id}" in ${path}; overriding previous definition.`,
					);
				}
				modes.set(parsed.id, parsed);
			} catch {
				// ignore malformed files
			}
		}
		return modes;
	}

	resolveById(id: string, rawModes: Map<string, ModeConfigSource>): ModeConfig {
		const seen = new Set<string>();
		let cycleDetected = false;
		const resolveInner = (modeId: string): ModeConfig => {
			if (seen.has(modeId)) {
				cycleDetected = true;
				return cloneMode(DEFAULT_MODE);
			}
			seen.add(modeId);
			const mode = rawModes.get(modeId);
			if (!mode) return cloneMode(DEFAULT_MODE);
			if (!mode.extends) {
				if (!isCompleteRootMode(mode)) return cloneMode(DEFAULT_MODE);
				return mergeMode(cloneMode(DEFAULT_MODE), mode);
			}
			const parent = resolveInner(mode.extends);
			if (cycleDetected) return cloneMode(DEFAULT_MODE);
			return mergeMode(parent, mode);
		};
		const resolved = resolveInner(id);
		return cycleDetected ? cloneMode(DEFAULT_MODE) : cloneMode(resolved);
	}
}

export function getDefaultModeConfig(): ModeConfig {
	return cloneMode(DEFAULT_MODE);
}
