// =============================================================================
// open-mem — AI Observation Compressor
// =============================================================================

import { type LanguageModel, generateText } from "ai";
import type { OpenMemConfig } from "../types";
import { type ParsedObservation, parseObservationResponse } from "./parser";
import { estimateTokens } from "./parser";
import { buildCompressionPrompt } from "./prompts";
import { createModel } from "./provider";
import { enforceRateLimit } from "./rate-limiter";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Configuration for the AI observation compressor. */
export interface CompressorConfig {
	provider: string;
	apiKey: string | undefined;
	model: string;
	maxTokensPerCompression: number;
	compressionEnabled: boolean;
	minOutputLength: number;
	rateLimitingEnabled: boolean;
}

// -----------------------------------------------------------------------------
// ObservationCompressor
// -----------------------------------------------------------------------------

/**
 * Compresses raw tool output into structured observations using the
 * Vercel AI SDK. Falls back to a heuristic-based observation
 * when the AI provider is unavailable or disabled.
 */
export class ObservationCompressor {
	private model: LanguageModel | null;
	private config: CompressorConfig;

	// Overridable for tests
	_generate = generateText;

	constructor(config: CompressorConfig) {
		this.config = config;
		this.model = null;

		const providerRequiresKey = config.provider !== "bedrock";
		if (config.compressionEnabled && (!providerRequiresKey || config.apiKey)) {
			try {
				this.model = createModel({
					provider: config.provider,
					model: config.model,
					apiKey: config.apiKey,
				});
			} catch {
				// Provider package not installed — fall back to no-AI mode
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Compression
	// ---------------------------------------------------------------------------

	/** Maximum input characters sent to the API (~12.5K tokens) */
	static readonly MAX_INPUT_LENGTH = 50_000;

	/**
	 * Compress a single tool output into a structured observation.
	 * Returns `null` when compression is disabled, the output is too short,
	 * or the API call fails after retries.
	 */
	async compress(
		toolName: string,
		toolOutput: string,
		sessionContext?: string,
	): Promise<ParsedObservation | null> {
		if (!this.config.compressionEnabled || !this.model) {
			return null;
		}

		if (toolOutput.length < this.config.minOutputLength) {
			return null;
		}

		const discoveryTokens = estimateTokens(toolOutput);

		// Truncate to cap API costs
		const truncated =
			toolOutput.length > ObservationCompressor.MAX_INPUT_LENGTH
				? `${toolOutput.substring(0, ObservationCompressor.MAX_INPUT_LENGTH)}\n\n[... truncated ...]`
				: toolOutput;

		const prompt = buildCompressionPrompt(toolName, truncated, sessionContext);

		const maxRetries = 2;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				if (this.config.provider === "google") {
					await enforceRateLimit(this.config.model, this.config.rateLimitingEnabled);
				}
				const { text } = await this._generate({
					model: this.model,
					maxOutputTokens: this.config.maxTokensPerCompression,
					prompt,
				});

				const parsed = parseObservationResponse(text);
				if (parsed) {
					parsed.discoveryTokens = discoveryTokens;
				}
				return parsed;
			} catch (error: unknown) {
				if (isRetryable(error) && attempt < maxRetries) {
					const delay = 2 ** attempt * 1000; // 1 s, 2 s
					await sleep(delay);
					continue;
				}
				return null;
			}
		}

		return null;
	}

	// ---------------------------------------------------------------------------
	// Batch Compression
	// ---------------------------------------------------------------------------

	/**
	 * Compress multiple items sequentially (avoids rate-limit bursts).
	 * Returns a map of `callId -> ParsedObservation | null`.
	 */
	async compressBatch(
		items: ReadonlyArray<{
			toolName: string;
			toolOutput: string;
			callId: string;
			sessionContext?: string;
		}>,
	): Promise<Map<string, ParsedObservation | null>> {
		const results = new Map<string, ParsedObservation | null>();

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const result = await this.compress(item.toolName, item.toolOutput, item.sessionContext);
			results.set(item.callId, result);

			// Small inter-request delay to stay under rate limits
			if (i < items.length - 1) {
				await sleep(200);
			}
		}

		return results;
	}

	// ---------------------------------------------------------------------------
	// Fallback (no API needed)
	// ---------------------------------------------------------------------------

	/**
	 * Produce a basic observation from tool metadata when AI compression
	 * is unavailable.
	 */
	createFallbackObservation(toolName: string, toolOutput: string): ParsedObservation {
		const filePaths = extractFilePaths(toolOutput);

		const type = TOOL_TYPE_MAP[toolName] ?? "discovery";

		return {
			type,
			title: `${toolName} execution`,
			subtitle: toolOutput.substring(0, 100).replace(/\n/g, " "),
			facts: [],
			narrative: `Tool ${toolName} was executed. Output length: ${toolOutput.length} chars.`,
			concepts: [],
			filesRead: type === "discovery" ? filePaths : [],
			filesModified: type === "change" ? filePaths : [],
			discoveryTokens: estimateTokens(toolOutput),
			importance: 2,
		};
	}

	// ---------------------------------------------------------------------------
	// Health Check
	// ---------------------------------------------------------------------------

	async isAvailable(): Promise<boolean> {
		if (!this.model) return false;
		try {
			await this._generate({
				model: this.model,
				maxOutputTokens: 10,
				prompt: "ping",
			});
			return true;
		} catch {
			return false;
		}
	}
}

// =============================================================================
// Helpers
// =============================================================================

const TOOL_TYPE_MAP: Record<string, ParsedObservation["type"]> = {
	Read: "discovery",
	Write: "change",
	Edit: "change",
	Bash: "change",
	Glob: "discovery",
	Grep: "discovery",
};

const FILE_PATH_RE = /(?:^|\s)((?:\.\/|\/|src\/|tests\/|lib\/)\S+\.\w+)/gm;

function extractFilePaths(text: string): string[] {
	const paths: string[] = [];
	for (const match of text.matchAll(FILE_PATH_RE)) {
		paths.push(match[1]);
	}
	return [...new Set(paths)];
}

function isRetryable(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const err = error as Record<string, unknown>;
	const status = err.status;
	if (status === 429 || status === 500 || status === 503) return true;
	const errObj = err.error;
	if (
		typeof errObj === "object" &&
		errObj !== null &&
		(errObj as Record<string, unknown>).type === "overloaded_error"
	) {
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
