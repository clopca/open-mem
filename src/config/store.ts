import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getDefaultConfig, resolveConfig } from "../config";
import type { OpenMemConfig } from "../types";

export interface ConfigFieldSchema {
	key: keyof OpenMemConfig;
	label: string;
	type: "string" | "number" | "boolean" | "array";
	group:
		| "Storage"
		| "AI"
		| "Behavior"
		| "Filtering"
		| "Progressive Disclosure"
		| "Privacy"
		| "Data Retention"
		| "Dashboard"
		| "Advanced";
	liveApply: boolean;
	restartRequired: boolean;
	secret?: boolean;
	min?: number;
	max?: number;
	enum?: string[];
	description?: string;
}

export interface ConfigValueMeta {
	source: "default" | "file" | "env";
	locked: boolean;
	restartRequired: boolean;
	liveApply: boolean;
}

export interface ConfigEffectiveResponse {
	config: OpenMemConfig;
	meta: Partial<Record<keyof OpenMemConfig, ConfigValueMeta>>;
	warnings: string[];
}

const FIELD_SCHEMA: ConfigFieldSchema[] = [
	{
		key: "dbPath",
		label: "Database Path",
		type: "string",
		group: "Storage",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "provider",
		label: "Provider",
		type: "string",
		group: "AI",
		liveApply: false,
		restartRequired: true,
		enum: ["google", "anthropic", "openai", "bedrock"],
	},
	{
		key: "model",
		label: "Model",
		type: "string",
		group: "AI",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "maxTokensPerCompression",
		label: "Max Tokens Per Compression",
		type: "number",
		group: "AI",
		liveApply: true,
		restartRequired: false,
		min: 128,
		max: 8192,
	},
	{
		key: "compressionEnabled",
		label: "Compression Enabled",
		type: "boolean",
		group: "Behavior",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "contextInjectionEnabled",
		label: "Context Injection Enabled",
		type: "boolean",
		group: "Behavior",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "maxContextTokens",
		label: "Max Context Tokens",
		type: "number",
		group: "Behavior",
		liveApply: true,
		restartRequired: false,
		min: 500,
		max: 64000,
	},
	{
		key: "batchSize",
		label: "Batch Size",
		type: "number",
		group: "Behavior",
		liveApply: true,
		restartRequired: false,
		min: 1,
		max: 100,
	},
	{
		key: "batchIntervalMs",
		label: "Batch Interval (ms)",
		type: "number",
		group: "Behavior",
		liveApply: true,
		restartRequired: false,
		min: 1000,
		max: 300000,
	},
	{
		key: "ignoredTools",
		label: "Ignored Tools",
		type: "array",
		group: "Filtering",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "minOutputLength",
		label: "Min Output Length",
		type: "number",
		group: "Filtering",
		liveApply: true,
		restartRequired: false,
		min: 0,
		max: 10000,
	},
	{
		key: "maxObservations",
		label: "Max Observations",
		type: "number",
		group: "Progressive Disclosure",
		liveApply: true,
		restartRequired: false,
		min: 1,
		max: 200,
	},
	{
		key: "contextFullObservationCount",
		label: "Full Observation Count",
		type: "number",
		group: "Progressive Disclosure",
		liveApply: true,
		restartRequired: false,
		min: 0,
		max: 20,
	},
	{
		key: "contextShowTokenCosts",
		label: "Show Token Costs",
		type: "boolean",
		group: "Progressive Disclosure",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "sensitivePatterns",
		label: "Sensitive Patterns",
		type: "array",
		group: "Privacy",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "retentionDays",
		label: "Retention Days",
		type: "number",
		group: "Data Retention",
		liveApply: false,
		restartRequired: true,
		min: 0,
		max: 3650,
	},
	{
		key: "maxDatabaseSizeMb",
		label: "Max Database Size (MB)",
		type: "number",
		group: "Data Retention",
		liveApply: false,
		restartRequired: true,
		min: 0,
		max: 100000,
	},
	{
		key: "dashboardEnabled",
		label: "Dashboard Enabled",
		type: "boolean",
		group: "Dashboard",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "dashboardPort",
		label: "Dashboard Port",
		type: "number",
		group: "Dashboard",
		liveApply: false,
		restartRequired: true,
		min: 1,
		max: 65535,
	},
	{
		key: "platformOpenCodeEnabled",
		label: "OpenCode Adapter",
		type: "boolean",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "platformClaudeCodeEnabled",
		label: "Claude Code Adapter",
		type: "boolean",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "platformCursorEnabled",
		label: "Cursor Adapter",
		type: "boolean",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "mcpProtocolVersion",
		label: "MCP Protocol Version",
		type: "string",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "mcpSupportedProtocolVersions",
		label: "MCP Supported Protocols",
		type: "array",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "rerankingEnabled",
		label: "Reranking Enabled",
		type: "boolean",
		group: "Advanced",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "entityExtractionEnabled",
		label: "Entity Extraction Enabled",
		type: "boolean",
		group: "Advanced",
		liveApply: true,
		restartRequired: false,
	},
	{
		key: "userMemoryEnabled",
		label: "User Memory Enabled",
		type: "boolean",
		group: "Advanced",
		liveApply: false,
		restartRequired: true,
	},
	{
		key: "userMemoryMaxContextTokens",
		label: "User Memory Max Context Tokens",
		type: "number",
		group: "Advanced",
		liveApply: true,
		restartRequired: false,
		min: 0,
		max: 8000,
	},
];

const ENV_BY_KEY: Partial<Record<keyof OpenMemConfig, string[]>> = {
	dbPath: ["OPEN_MEM_DB_PATH"],
	provider: ["OPEN_MEM_PROVIDER"],
	model: ["OPEN_MEM_MODEL"],
	compressionEnabled: ["OPEN_MEM_COMPRESSION"],
	contextInjectionEnabled: ["OPEN_MEM_CONTEXT_INJECTION"],
	maxContextTokens: ["OPEN_MEM_MAX_CONTEXT_TOKENS"],
	ignoredTools: ["OPEN_MEM_IGNORED_TOOLS"],
	batchSize: ["OPEN_MEM_BATCH_SIZE"],
	retentionDays: ["OPEN_MEM_RETENTION_DAYS"],
	contextShowTokenCosts: ["OPEN_MEM_CONTEXT_SHOW_TOKEN_COSTS"],
	contextFullObservationCount: ["OPEN_MEM_CONTEXT_FULL_COUNT"],
	maxObservations: ["OPEN_MEM_MAX_OBSERVATIONS"],
	dashboardEnabled: ["OPEN_MEM_DASHBOARD"],
	dashboardPort: ["OPEN_MEM_DASHBOARD_PORT"],
	platformOpenCodeEnabled: ["OPEN_MEM_PLATFORM_OPENCODE"],
	platformClaudeCodeEnabled: ["OPEN_MEM_PLATFORM_CLAUDE_CODE"],
	platformCursorEnabled: ["OPEN_MEM_PLATFORM_CURSOR"],
	mcpProtocolVersion: ["OPEN_MEM_MCP_PROTOCOL_VERSION"],
	mcpSupportedProtocolVersions: ["OPEN_MEM_MCP_SUPPORTED_PROTOCOLS"],
	rerankingEnabled: ["OPEN_MEM_RERANKING"],
	userMemoryEnabled: ["OPEN_MEM_USER_MEMORY"],
};

function configFilePath(projectPath: string): string {
	return join(projectPath, ".open-mem", "config.json");
}

function getFieldSchema(key: keyof OpenMemConfig): ConfigFieldSchema | undefined {
	return FIELD_SCHEMA.find((field) => field.key === key);
}

function validatePatchValue(key: keyof OpenMemConfig, value: unknown): string | null {
	const schema = getFieldSchema(key);
	if (!schema) return null;
	if (schema.type === "string" && typeof value !== "string")
		return `${String(key)} must be a string`;
	if (schema.type === "number" && typeof value !== "number")
		return `${String(key)} must be a number`;
	if (schema.type === "boolean" && typeof value !== "boolean")
		return `${String(key)} must be a boolean`;
	if (schema.type === "array" && !Array.isArray(value)) return `${String(key)} must be an array`;
	if (schema.enum && typeof value === "string" && !schema.enum.includes(value))
		return `${String(key)} must be one of: ${schema.enum.join(", ")}`;
	if (typeof value === "number") {
		if (schema.min !== undefined && value < schema.min)
			return `${String(key)} must be >= ${schema.min}`;
		if (schema.max !== undefined && value > schema.max)
			return `${String(key)} must be <= ${schema.max}`;
	}
	return null;
}

export function getConfigSchema(): ConfigFieldSchema[] {
	return FIELD_SCHEMA;
}

export async function readProjectConfig(projectPath: string): Promise<Partial<OpenMemConfig>> {
	const path = configFilePath(projectPath);
	if (!existsSync(path)) return {};
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as Partial<OpenMemConfig>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
		return parsed;
	} catch {
		return {};
	}
}

export async function writeProjectConfig(
	projectPath: string,
	patch: Partial<OpenMemConfig>,
): Promise<void> {
	const path = configFilePath(projectPath);
	const current = await readProjectConfig(projectPath);
	const merged = { ...current, ...patch };
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(merged, null, 2), "utf-8");
}

export function validatePatch(patch: Partial<OpenMemConfig>): string[] {
	const errors: string[] = [];
	for (const [rawKey, value] of Object.entries(patch)) {
		const key = rawKey as keyof OpenMemConfig;
		const err = validatePatchValue(key, value);
		if (err) errors.push(err);
	}
	return errors;
}

export async function getEffectiveConfig(projectPath: string): Promise<ConfigEffectiveResponse> {
	const defaults = getDefaultConfig();
	const fileConfig = await readProjectConfig(projectPath);
	const effective = resolveConfig(projectPath);
	const warnings: string[] = [];
	const meta: Partial<Record<keyof OpenMemConfig, ConfigValueMeta>> = {};

	for (const [k, defaultValue] of Object.entries(defaults)) {
		const key = k as keyof OpenMemConfig;
		const schema = getFieldSchema(key);
		const envKeys = ENV_BY_KEY[key] ?? [];
		const envHit = envKeys.some((envKey) => typeof process.env[envKey] === "string");
		const fileHasKey = Object.hasOwn(fileConfig, key);
		let source: ConfigValueMeta["source"] = "default";
		if (fileHasKey) source = "file";
		if (envHit) source = "env";

		meta[key] = {
			source,
			locked: envHit,
			restartRequired: schema?.restartRequired ?? false,
			liveApply: schema?.liveApply ?? false,
		};

		if (source === "env" && fileHasKey) {
			warnings.push(`${String(key)} is overridden by environment variable.`);
		}
		if (effective[key] === undefined && defaultValue !== undefined) {
			warnings.push(`${String(key)} resolved to undefined unexpectedly.`);
		}
	}

	return { config: effective, meta, warnings };
}

export async function previewConfig(
	projectPath: string,
	patch: Partial<OpenMemConfig>,
): Promise<ConfigEffectiveResponse> {
	const errors = validatePatch(patch);
	if (errors.length > 0) {
		return {
			...(await getEffectiveConfig(projectPath)),
			warnings: errors,
		};
	}

	const defaults = getDefaultConfig();
	const fileConfig = await readProjectConfig(projectPath);
	const base = { ...defaults, ...fileConfig, ...patch };
	const live = resolveConfig(projectPath, patch);
	const config = { ...live, ...base };
	const baseMeta = (await getEffectiveConfig(projectPath)).meta;
	return { config, meta: baseMeta, warnings: [] };
}

export async function patchConfig(
	projectPath: string,
	patch: Partial<OpenMemConfig>,
): Promise<ConfigEffectiveResponse> {
	const errors = validatePatch(patch);
	if (errors.length > 0) {
		return {
			...(await getEffectiveConfig(projectPath)),
			warnings: errors,
		};
	}
	await writeProjectConfig(projectPath, patch);
	return getEffectiveConfig(projectPath);
}
