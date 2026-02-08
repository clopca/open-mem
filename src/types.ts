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
	scope?: "project" | "user";
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
	discoveryTokens: number; // Original input size in tokens (for ROI tracking)
	importance: number; // AI-assigned importance score (1-5, default 3)
	revisionOf?: string | null;
	deletedAt?: string | null;
	supersededBy?: string | null;
	supersededAt?: string | null;
}

/** Lightweight index entry for progressive disclosure */
export interface ObservationIndex {
	id: string;
	sessionId: string;
	type: ObservationType;
	title: string;
	tokenCount: number;
	discoveryTokens: number;
	createdAt: string;
	importance: number;
}

// -----------------------------------------------------------------------------
// Session Types
// -----------------------------------------------------------------------------

/** An active or completed coding session. */
export interface Session {
	id: string; // OpenCode session ID
	projectPath: string; // Project directory
	startedAt: string; // ISO 8601
	endedAt: string | null; // ISO 8601 or null if active
	status: "active" | "idle" | "completed";
	observationCount: number;
	summaryId: string | null; // Reference to session summary
}

/** AI-generated summary of a coding session. */
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

/** A pending tool output awaiting AI compression. */
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

/** Queued work item for the background processor. */
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

/** Full configuration for the open-mem plugin. */
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

	// Folder context (AGENTS.md generation)
	folderContextEnabled: boolean; // Auto-generate AGENTS.md in active folders
	folderContextMaxDepth: number; // Max folder depth from project root

	// Daemon
	daemonEnabled: boolean; // Enable background daemon for queue processing (default: false)

	// Dashboard
	dashboardEnabled: boolean; // Enable web dashboard (default: false)
	dashboardPort: number; // Dashboard HTTP port (default: 3737)

	// Platform adapters
	platformOpenCodeEnabled?: boolean; // Enable OpenCode adapter surface
	platformClaudeCodeEnabled?: boolean; // Enable Claude Code adapter surface
	platformCursorEnabled?: boolean; // Enable Cursor adapter surface

	// MCP compatibility
	mcpCompatibilityMode?: "strict" | "legacy";
	mcpProtocolVersion?: string;
	mcpSupportedProtocolVersions?: string[];

	// Embeddings
	embeddingDimension?: number; // Embedding vector dimension (auto-detected from provider)

	// Conflict resolution
	conflictResolutionEnabled: boolean;
	conflictSimilarityBandLow: number;
	conflictSimilarityBandHigh: number;

	// User-level memory (cross-project)
	userMemoryEnabled: boolean; // Enable user-level cross-project memory
	userMemoryDbPath: string; // Path to user-level memory database
	userMemoryMaxContextTokens: number; // Token budget for user-level context

	// Reranking
	rerankingEnabled: boolean; // Enable LLM-based reranking of search results (default: false)
	rerankingMaxCandidates: number; // Max candidates to consider for reranking (default: 20)

	// Entity extraction (graph memory)
	entityExtractionEnabled: boolean;
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

	tool?: Record<string, ToolDefinition>;
}

/** An event emitted by OpenCode (e.g. tool execution, session lifecycle). */
export interface OpenCodeEvent {
	type: string;
	properties: Record<string, unknown>;
}

/** Schema for a custom tool exposed to the AI agent. */
export interface ToolDefinition {
	description: string;
	args: Record<string, unknown>; // Zod schema
	execute: (args: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/** Runtime context passed to a tool's execute function. */
export interface ToolContext {
	sessionID: string;
	abort: AbortSignal;
	messageID?: string;
	agent?: string;
	directory?: string;
	worktree?: string;
	metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
	ask?: (input: unknown) => Promise<void>;
}

/** Plugin type — entry point for OpenCode plugins */
export type Plugin = (input: PluginInput) => Promise<Hooks>;

// -----------------------------------------------------------------------------
// Search / Query Types
// -----------------------------------------------------------------------------

/** FTS5 search query parameters with optional filters. */
export interface SearchQuery {
	query: string;
	sessionId?: string;
	type?: ObservationType;
	limit?: number;
	offset?: number;
	projectPath?: string;
	importanceMin?: number;
	importanceMax?: number;
	createdAfter?: string; // ISO 8601 date
	createdBefore?: string; // ISO 8601 date
	concepts?: string[]; // Filter by concepts (match any)
	files?: string[]; // Filter by file paths (match any)
}

/** A search result pairing an observation with its relevance rank. */
export interface SearchResult {
	observation: Observation;
	rank: number; // FTS5 rank score
	snippet: string; // FTS5 highlighted snippet
	source?: "project" | "user";
	rankingSource?: RankingSignalSource;
	explain?: {
		strategy?: "filter-only" | "semantic" | "hybrid";
		matchedBy: Array<"fts" | "vector" | "graph" | "user-memory" | "concept-filter" | "file-filter">;
		ftsRank?: number;
		vectorDistance?: number;
		vectorSimilarity?: number;
		rrfScore?: number;
		signals?: SearchExplainSignal[];
		lineage?: SearchLineageRef;
	};
}

/** A session with its summary and observation count for timeline display. */
export interface TimelineEntry {
	session: Session;
	summary: SessionSummary | null;
	observationCount: number;
}

// -----------------------------------------------------------------------------
// Search Explainability Types
// -----------------------------------------------------------------------------

/** Source that contributed to a search result's ranking. */
export type RankingSignalSource = "fts" | "vector" | "graph" | "user-memory";

/** A single explainability signal describing why a result was ranked. */
export interface SearchExplainSignal {
	source: RankingSignalSource;
	score?: number;
	label?: string;
}

/** Reference to a lineage chain for a search result observation. */
export interface SearchLineageRef {
	rootId: string;
	depth: number;
}

// -----------------------------------------------------------------------------
// Revision Diff Types
// -----------------------------------------------------------------------------

/** Describes the diff between two observation revisions. */
export interface RevisionDiff {
	baseId: string;
	againstId: string;
	changes: Array<{
		field: string;
		before: unknown;
		after: unknown;
	}>;
}

// -----------------------------------------------------------------------------
// Adapter Status Types
// -----------------------------------------------------------------------------

/** Runtime status of a platform adapter. */
export interface AdapterStatus {
	name: string;
	version: string;
	enabled: boolean;
	capabilities: Record<string, boolean>;
}

// -----------------------------------------------------------------------------
// Config Audit Types
// -----------------------------------------------------------------------------

/** A single config audit event tracking a configuration change. */
export interface ConfigAuditEvent {
	id: string;
	timestamp: string;
	patch: Record<string, unknown>;
	previousValues: Record<string, unknown>;
	source: "api" | "mode" | "rollback";
}

// -----------------------------------------------------------------------------
// Maintenance History Types
// -----------------------------------------------------------------------------

/** A single maintenance operation result. */
export interface MaintenanceHistoryItem {
	id: string;
	timestamp: string;
	action: string;
	dryRun: boolean;
	result: Record<string, unknown>;
}
