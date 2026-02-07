// =============================================================================
// open-mem — Queue Processor
// =============================================================================

import type { EmbeddingModel } from "ai";
import type { ObservationCompressor } from "../ai/compressor";
import type { ConflictEvaluator } from "../ai/conflict-evaluator";
import type { EntityExtractor } from "../ai/entity-extractor";
import { estimateTokens } from "../ai/parser";
import type { SessionSummarizer } from "../ai/summarizer";
import type { EntityRepository } from "../db/entities";
import type { ObservationRepository } from "../db/observations";
import type { PendingMessageRepository } from "../db/pending";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { generateEmbedding, prepareObservationText } from "../search/embeddings";

// -----------------------------------------------------------------------------
// Config subset needed by the processor
// -----------------------------------------------------------------------------

export type ProcessingMode = "in-process" | "enqueue-only";

export interface QueueProcessorConfig {
	batchSize: number;
	batchIntervalMs: number;
	conflictResolutionEnabled?: boolean;
	conflictSimilarityBandLow?: number;
	conflictSimilarityBandHigh?: number;
	entityExtractionEnabled?: boolean;
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
	private mode: ProcessingMode = "in-process";
	private onEnqueue: (() => void) | null = null;

	constructor(
		private config: QueueProcessorConfig,
		private compressor: ObservationCompressor,
		private summarizer: SessionSummarizer,
		private pendingRepo: PendingMessageRepository,
		private observationRepo: ObservationRepository,
		private sessionRepo: SessionRepository,
		private summaryRepo: SummaryRepository,
		private embeddingModel: EmbeddingModel | null = null,
		private conflictEvaluator: ConflictEvaluator | null = null,
		private entityExtractor: EntityExtractor | null = null,
		private entityRepo: EntityRepository | null = null,
	) {}

	setMode(mode: ProcessingMode): void {
		this.mode = mode;
		if (mode === "enqueue-only") {
			this.stop();
		}
	}

	getMode(): ProcessingMode {
		return this.mode;
	}

	setOnEnqueue(callback: (() => void) | null): void {
		this.onEnqueue = callback;
	}

	// ---------------------------------------------------------------------------
	// Enqueue
	// ---------------------------------------------------------------------------

	/** Add a new pending message to the queue */
	enqueue(sessionId: string, toolName: string, toolOutput: string, callId: string): void {
		this.pendingRepo.create({ sessionId, toolName, toolOutput, callId });
		if (this.mode === "enqueue-only") {
			this.onEnqueue?.();
		}
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
		if (this.mode === "enqueue-only") return 0;
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

				// ---------------------------------------------------------------
				// Dedup / Conflict Resolution
				// ---------------------------------------------------------------
				let skipObservation = false;
				let conflictSupersedesId: string | null = null;

				if (this.embeddingModel) {
					try {
						const dedupText = prepareObservationText({
							title: observation.title,
							narrative: observation.narrative,
							concepts: observation.concepts,
						});
						const dedupEmbedding = await generateEmbedding(this.embeddingModel, dedupText);
						if (dedupEmbedding) {
							const conflictEnabled =
								this.config.conflictResolutionEnabled && this.conflictEvaluator;
							const bandLow = this.config.conflictSimilarityBandLow ?? 0.7;
							const bandHigh = this.config.conflictSimilarityBandHigh ?? 0.92;

							if (conflictEnabled) {
								// Conflict resolution path: use lower threshold to catch gray-zone
								const similar = this.observationRepo.findSimilar(
									dedupEmbedding,
									observation.type,
									bandLow,
									5,
								);

								// Fast path: any result above bandHigh → skip (same as original dedup)
								const exactDup = similar.find((s) => s.similarity > bandHigh);
								if (exactDup) {
									console.log(
										`[open-mem] Dedup: skipping duplicate of ${exactDup.id} (similarity: ${exactDup.similarity.toFixed(3)})`,
									);
									skipObservation = true;
								} else {
									// Gray zone: results in [bandLow, bandHigh]
									const grayZone = similar.filter(
										(s) => s.similarity >= bandLow && s.similarity <= bandHigh,
									);
									if (grayZone.length > 0) {
										try {
											const candidates = grayZone
												.map((s) => {
													const obs = this.observationRepo.getById(s.id);
													return obs
														? {
																id: obs.id,
																title: obs.title,
																narrative: obs.narrative,
																concepts: obs.concepts,
																type: obs.type,
															}
														: null;
												})
												.filter(
													(c): c is NonNullable<typeof c> => c !== null,
												);

											if (candidates.length > 0) {
												const evaluation =
													await this.conflictEvaluator!.evaluate(
														{
															title: observation.title,
															narrative: observation.narrative,
															concepts: observation.concepts,
															type: observation.type,
														},
														candidates,
													);

												if (
													evaluation &&
													evaluation.outcome === "duplicate"
												) {
													console.log(
														`[open-mem] Conflict eval: duplicate (${evaluation.reason})`,
													);
													skipObservation = true;
												} else if (
													evaluation &&
													evaluation.outcome === "update" &&
													evaluation.supersedesId
												) {
													console.log(
														`[open-mem] Conflict eval: update supersedes ${evaluation.supersedesId} (${evaluation.reason})`,
													);
													conflictSupersedesId =
														evaluation.supersedesId;
												}
												// else: new_fact or null → fall through to create
											}
										} catch {
											// Evaluator failure → fall through to create new observation
										}
									}
								}
							} else {
								// Original behavior: simple dedup at 0.92
								const similar = this.observationRepo.findSimilar(
									dedupEmbedding,
									observation.type,
									0.92,
									1,
								);
								if (similar.length > 0) {
									console.log(
										`[open-mem] Dedup: skipping duplicate of ${similar[0].id} (similarity: ${similar[0].similarity.toFixed(3)})`,
									);
									skipObservation = true;
								}
							}
						}
					} catch {
						// Dedup failure must not block observation creation
					}
				}

				if (skipObservation) {
					this.pendingRepo.markCompleted(item.id);
					continue;
				}

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
					importance: observation.importance ?? 3,
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

					if (conflictSupersedesId) {
						try {
							this.observationRepo.supersede(conflictSupersedesId, created.id);
							console.log(
								`[open-mem] Superseded observation ${conflictSupersedesId} with ${created.id}`,
							);
						} catch {
							// Supersede failure must not block observation creation
						}
					}

					// ---------------------------------------------------------------
					// Entity Extraction (Knowledge Graph)
					// ---------------------------------------------------------------
					if (this.config.entityExtractionEnabled && this.entityExtractor && this.entityRepo) {
						try {
							const extraction = await this.entityExtractor.extract({
								title: created.title,
								narrative: created.narrative,
								concepts: created.concepts,
								facts: created.facts,
								filesRead: created.filesRead,
								filesModified: created.filesModified,
								type: created.type,
							});
							if (extraction) {
								const entityMap = new Map<string, string>();
								for (const e of extraction.entities) {
									const entity = this.entityRepo.upsertEntity(e.name, e.entityType);
									entityMap.set(e.name, entity.id);
									this.entityRepo.linkObservation(entity.id, created.id);
								}
								for (const r of extraction.relations) {
									const sourceId = entityMap.get(r.sourceName);
									const targetId = entityMap.get(r.targetName);
									if (sourceId && targetId) {
										this.entityRepo.createRelation(sourceId, targetId, r.relationship, created.id);
									}
								}
							}
						} catch {
							// Entity extraction failure must NOT block observation creation
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
		if (this.mode === "enqueue-only") return;
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
