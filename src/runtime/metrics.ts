import type { ProcessingMode, QueueObserver } from "../queue/processor";

export interface RuntimeQueueStatus {
	mode: ProcessingMode;
	running: boolean;
	processing: boolean;
	pending: number;
	lastBatchDurationMs: number;
	lastProcessedAt: string | null;
	lastFailedAt: string | null;
	lastError: string | null;
}

export interface RuntimeMetricsSnapshot {
	startedAt: string;
	uptimeMs: number;
	enqueueCount: number;
	batches: {
		total: number;
		processedItems: number;
		failedItems: number;
		avgDurationMs: number;
	};
	queue: RuntimeQueueStatus;
}

export class RuntimeMetricsCollector {
	private readonly startedAtMs = Date.now();
	private enqueueCount = 0;
	private totalBatches = 0;
	private processedItems = 0;
	private failedItems = 0;
	private totalBatchDurationMs = 0;
	private lastBatchDurationMs = 0;
	private lastProcessedAt: string | null = null;
	private lastFailedAt: string | null = null;
	private lastError: string | null = null;

	createQueueObserver(): QueueObserver {
		return {
			onEnqueue: () => {
				this.enqueueCount += 1;
			},
			onBatchEnd: (payload) => {
				this.totalBatches += 1;
				this.processedItems += payload.processed;
				this.failedItems += payload.failed;
				this.totalBatchDurationMs += payload.durationMs;
				this.lastBatchDurationMs = payload.durationMs;
				if (payload.processed > 0) this.lastProcessedAt = payload.finishedAt;
			},
			onItemFailed: (payload) => {
				this.lastFailedAt = payload.failedAt;
				this.lastError = payload.error;
			},
		};
	}

	snapshot(queue: {
		mode: ProcessingMode;
		running: boolean;
		processing: boolean;
		pending: number;
	}): RuntimeMetricsSnapshot {
		return {
			startedAt: new Date(this.startedAtMs).toISOString(),
			uptimeMs: Date.now() - this.startedAtMs,
			enqueueCount: this.enqueueCount,
			batches: {
				total: this.totalBatches,
				processedItems: this.processedItems,
				failedItems: this.failedItems,
				avgDurationMs:
					this.totalBatches > 0 ? Math.round(this.totalBatchDurationMs / this.totalBatches) : 0,
			},
			queue: {
				...queue,
				lastBatchDurationMs: this.lastBatchDurationMs,
				lastProcessedAt: this.lastProcessedAt,
				lastFailedAt: this.lastFailedAt,
				lastError: this.lastError,
			},
		};
	}
}
