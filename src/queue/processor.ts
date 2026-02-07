// =============================================================================
// open-mem — Queue Processor
// =============================================================================

import type { EmbeddingModel } from "ai";
import type { ObservationCompressor } from "../ai/compressor";
import { estimateTokens } from "../ai/parser";
import type { SessionSummarizer } from "../ai/summarizer";
import type { ObservationRepository } from "../db/observations";
import type { PendingMessageRepository } from "../db/pending";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { generateEmbedding, prepareObservationText } from "../search/embeddings";

// -----------------------------------------------------------------------------
// Config subset needed by the processor
// -----------------------------------------------------------------------------

export interface QueueProcessorConfig {
	batchSize: number;
	batchIntervalMs: number;
}

// -----------------------------------------------------------------------------
// QueueProcessor
// -----------------------------------------------------------------------------

/**
 * Orchestrates asynchronous observation processing:
 * 1. Dequeues pending tool outputs from SQLite
 * 2. Compresses them via the AI compressor (or falls back)
 * 3. Stores resulting observations
 * 4. Optionally summarizes completed sessions
 *
 * Processing can be triggered by `session.idle` events or a periodic timer.
 */
export class QueueProcessor {
	private processing = false;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private config: QueueProcessorConfig,
		private compressor: ObservationCompressor,
		private summarizer: SessionSummarizer,
		private pendingRepo: PendingMessageRepository,
		private observationRepo: ObservationRepository,
		private sessionRepo: SessionRepository,
		private summaryRepo: SummaryRepository,
		private embeddingModel: EmbeddingModel | null = null,
	) {}

	// ---------------------------------------------------------------------------
	// Enqueue
	// ---------------------------------------------------------------------------

	/** Add a new pending message to the queue */
	enqueue(sessionId: string, toolName: string, toolOutput: string, callId: string): void {
		this.pendingRepo.create({ sessionId, toolName, toolOutput, callId });
	}

	// ---------------------------------------------------------------------------
	// Batch Processing
	// ---------------------------------------------------------------------------

	/**
	 * Process up to `batchSize` pending messages. Returns the number
	 * of items successfully processed. Concurrent calls are serialized
	 * via a simple `processing` flag.
	 */
	async processBatch(): Promise<number> {
		if (this.processing) return 0;

		this.processing = true;
		let processed = 0;

		try {
			// Recover any items stuck in "processing" from a prior crash
			this.pendingRepo.resetStale(5);

			const pending = this.pendingRepo.getPending(this.config.batchSize);
			if (pending.length === 0) return 0;

			for (const item of pending) {
				try {
					this.pendingRepo.markProcessing(item.id);

					const parsed = await this.compressor.compress(item.toolName, item.toolOutput);

					const observation =
						parsed ?? this.compressor.createFallbackObservation(item.toolName, item.toolOutput);

					const created = this.observationRepo.create({
						sessionId: item.sessionId,
						type: observation.type,
						title: observation.title,
						subtitle: observation.subtitle,
						facts: observation.facts,
						narrative: observation.narrative,
						concepts: observation.concepts,
						filesRead: observation.filesRead,
						filesModified: observation.filesModified,
						rawToolOutput: item.toolOutput,
						toolName: item.toolName,
						tokenCount: estimateTokens(
							`${observation.title} ${observation.narrative} ${observation.facts.join(" ")}`,
						),
						discoveryTokens: observation.discoveryTokens ?? estimateTokens(item.toolOutput),
					});

					if (this.embeddingModel) {
						try {
							const text = prepareObservationText({
								title: created.title,
								narrative: created.narrative,
								concepts: created.concepts,
							});
							const embedding = await generateEmbedding(this.embeddingModel, text);
							if (embedding) {
								this.observationRepo.setEmbedding(created.id, embedding);
							}
						} catch {
							// Embedding failure must not affect observation creation
						}
					}

					this.sessionRepo.incrementObservationCount(item.sessionId);
					this.pendingRepo.markCompleted(item.id);
					processed++;
				} catch (error) {
					this.pendingRepo.markFailed(item.id, String(error));
				}
			}

			return processed;
		} finally {
			this.processing = false;
		}
	}

	// ---------------------------------------------------------------------------
	// Session Summarization
	// ---------------------------------------------------------------------------

	/** Generate and store a summary for the given session */
	async summarizeSession(sessionId: string): Promise<void> {
		const observations = this.observationRepo.getBySession(sessionId);

		if (!this.summarizer.shouldSummarize(observations.length)) return;

		// Don't duplicate summaries
		const existing = this.summaryRepo.getBySessionId(sessionId);
		if (existing) return;

		const parsed = await this.summarizer.summarize(sessionId, observations);
		if (!parsed) return;

		const summary = this.summaryRepo.create({
			sessionId,
			summary: parsed.summary,
			keyDecisions: parsed.keyDecisions,
			filesModified: parsed.filesModified,
			concepts: parsed.concepts,
			tokenCount: estimateTokens(parsed.summary),
		});

		this.sessionRepo.setSummary(sessionId, summary.id);
	}

	// ---------------------------------------------------------------------------
	// Timer-based Processing
	// ---------------------------------------------------------------------------

	/** Start periodic batch processing */
	start(): void {
		if (this.timer) return;
		this.timer = setInterval(async () => {
			try {
				await this.processBatch();
			} catch {
				// swallow — timer errors must not propagate
			}
		}, this.config.batchIntervalMs);
	}

	/** Stop the periodic timer */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	get isRunning(): boolean {
		return this.timer !== null;
	}

	get isProcessing(): boolean {
		return this.processing;
	}

	// ---------------------------------------------------------------------------
	// Stats
	// ---------------------------------------------------------------------------

	getStats(): { pending: number; processing: boolean } {
		return {
			pending: this.pendingRepo.getPending(1000).length,
			processing: this.processing,
		};
	}
}
