// =============================================================================
// open-mem — Shared Types and Interfaces
// =============================================================================

// -----------------------------------------------------------------------------
// Observation Types
// -----------------------------------------------------------------------------

/** Observation types matching claude-mem's schema */
export type ObservationType =
	| "decision"
	| "bugfix"
	| "feature"
	| "refactor"
	| "discovery"
	| "change";

/** Full observation record stored in the database */
export interface Observation {
	id: string;
	sessionId: string;
	type: ObservationType;
	title: string;
	subtitle: string;
	facts: string[];
	narrative: string;
	concepts: string[];
	filesRead: string[];
	filesModified: string[];
	rawToolOutput: string; // Original tool output before compression
	toolName: string; // Which tool generated this
	createdAt: string; // ISO 8601
	tokenCount: number; // Estimated tokens for budget management
}

/** Lightweight index entry for progressive disclosure */
export interface ObservationIndex {
	id: string;
	sessionId: string;
	type: ObservationType;
	title: string;
	tokenCount: number;
	createdAt: string;
}

// -----------------------------------------------------------------------------
// Session Types
// -----------------------------------------------------------------------------

export interface Session {
	id: string; // OpenCode session ID
	projectPath: string; // Project directory
	startedAt: string; // ISO 8601
	endedAt: string | null; // ISO 8601 or null if active
	status: "active" | "idle" | "completed";
	observationCount: number;
	summaryId: string | null; // Reference to session summary
}

export interface SessionSummary {
	id: string;
	sessionId: string;
	summary: string; // AI-generated session summary
	keyDecisions: string[];
	filesModified: string[];
	concepts: string[];
	createdAt: string;
	tokenCount: number;
	request?: string;
	investigated?: string;
	learned?: string;
	completed?: string;
	nextSteps?: string;
}

// -----------------------------------------------------------------------------
// Queue Types
// -----------------------------------------------------------------------------

export interface PendingMessage {
	id: string;
	sessionId: string;
	toolName: string;
	toolOutput: string;
	callId: string;
	createdAt: string;
	status: "pending" | "processing" | "completed" | "failed";
	retryCount: number;
	error: string | null;
}

export type QueueItem =
	| {
			type: "compress";
			pendingMessageId: string;
			sessionId: string;
			toolName: string;
			toolOutput: string;
			callId: string;
	  }
	| {
			type: "summarize";
			sessionId: string;
	  };

// -----------------------------------------------------------------------------
// Configuration Types
// -----------------------------------------------------------------------------

export interface OpenMemConfig {
	// Storage
	dbPath: string; // Path to SQLite database file

	// AI
	provider: string; // AI provider: "anthropic" | "bedrock" | "openai" | "google"
	apiKey: string | undefined; // Provider API key (env: ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
	model: string; // Model for compression (default: claude-sonnet-4-20250514)
	maxTokensPerCompression: number; // Max tokens for compression response

	// Behavior
	compressionEnabled: boolean; // Enable/disable AI compression
	contextInjectionEnabled: boolean; // Enable/disable context injection
	maxContextTokens: number; // Token budget for injected context
	batchSize: number; // Number of observations to process per batch
	batchIntervalMs: number; // Interval between batch processing

	// Filtering
	ignoredTools: string[]; // Tools to ignore (e.g., ["Bash"] for noisy tools)
	minOutputLength: number; // Minimum tool output length to capture

	// Progressive disclosure
	maxIndexEntries: number; // Max observation index entries in context

	// Privacy
	sensitivePatterns: string[]; // Regex patterns to redact from observations

	// Data retention
	retentionDays: number; // Delete observations older than N days (0 = keep forever)
	maxDatabaseSizeMb: number; // Max database size in MB (0 = unlimited)

	// Logging
	logLevel: "debug" | "info" | "warn" | "error"; // Log verbosity

	// Context injection customization
	contextShowTokenCosts: boolean; // Show ~NNNt in observation index
	contextObservationTypes: ObservationType[] | "all"; // Filter which types appear
	contextFullObservationCount: number; // How many recent observations show full details
	maxObservations: number; // Total observations to include in context
	contextShowLastSummary: boolean; // Show last session summary

	// Rate limiting
	rateLimitingEnabled: boolean; // Enable rate limiting for Gemini free tier
}

// -----------------------------------------------------------------------------
// OpenCode Plugin API Types
// -----------------------------------------------------------------------------

/** OpenCode plugin input shape */
export interface PluginInput {
	client: unknown; // OpenCode client instance
	project: string; // Project name
	directory: string; // Project directory path
	worktree: string; // Git worktree path
	serverUrl: string; // OpenCode server URL
	$: unknown; // Shell helper
}

/** OpenCode hook definitions */
export interface Hooks {
	"tool.execute.after"?: (
		input: { tool: string; sessionID: string; callID: string },
		output: {
			title: string;
			output: string;
			metadata: Record<string, unknown>;
		},
	) => Promise<void>;

	"chat.message"?: (
		input: {
			sessionID: string;
			agent?: string;
			model?: string;
			messageID?: string;
		},
		output: { message: unknown; parts: unknown[] },
	) => Promise<void>;

	"experimental.chat.system.transform"?: (
		input: { sessionID?: string; model: string },
		output: { system: string[] },
	) => Promise<void>;

	"experimental.session.compacting"?: (
		input: { sessionID: string },
		output: { context: string[]; prompt?: string },
	) => Promise<void>;

	event?: (input: { event: OpenCodeEvent }) => Promise<void>;

	tools?: ToolDefinition[];
}

export interface OpenCodeEvent {
	type: string;
	properties: Record<string, unknown>;
}

export interface ToolDefinition {
	name: string;
	description: string;
	args: Record<string, unknown>; // Zod schema
	execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

export interface ToolContext {
	sessionID: string;
	abort: AbortSignal;
}

/** Plugin type — entry point for OpenCode plugins */
export type Plugin = (input: PluginInput) => Promise<Hooks>;

// -----------------------------------------------------------------------------
// Search / Query Types
// -----------------------------------------------------------------------------

export interface SearchQuery {
	query: string;
	sessionId?: string;
	type?: ObservationType;
	limit?: number;
	offset?: number;
}

export interface SearchResult {
	observation: Observation;
	rank: number; // FTS5 rank score
	snippet: string; // FTS5 highlighted snippet
}

export interface TimelineEntry {
	session: Session;
	summary: SessionSummary | null;
	observationCount: number;
}
