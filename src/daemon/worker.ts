// =============================================================================
// open-mem — Daemon Worker (Polling Loop)
// =============================================================================

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface BatchProcessor {
	processBatch(): Promise<number>;
}

export interface DaemonWorkerOptions {
	queueProcessor: BatchProcessor;
	pollIntervalMs: number;
}

// -----------------------------------------------------------------------------
// DaemonWorker
// -----------------------------------------------------------------------------

const AUTO_EXIT_IDLE_MS = 60_000;

export class DaemonWorker {
	private queueProcessor: BatchProcessor;
	private pollIntervalMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private lastActiveAt: number = Date.now();
	private processing = false;

	constructor(options: DaemonWorkerOptions) {
		this.queueProcessor = options.queueProcessor;
		this.pollIntervalMs = options.pollIntervalMs;
	}

	start(): void {
		if (this.timer) return;
		this.lastActiveAt = Date.now();

		this.timer = setInterval(async () => {
			if (this.processing) return;
			this.processing = true;
			try {
				const processed = await this.queueProcessor.processBatch();
				if (processed > 0) {
					this.lastActiveAt = Date.now();
				}
			} catch {
				// Swallow — polling errors must not crash the loop
			} finally {
				this.processing = false;
			}
		}, this.pollIntervalMs);
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	get isRunning(): boolean {
		return this.timer !== null;
	}

	get idleMs(): number {
		return Date.now() - this.lastActiveAt;
	}

	get shouldAutoExit(): boolean {
		return this.idleMs >= AUTO_EXIT_IDLE_MS && !process.send;
	}

	handleMessage(message: unknown): void {
		if (message === "SHUTDOWN") {
			this.stop();
		} else if (message === "PROCESS_NOW") {
			if (!this.processing) {
				this.processing = true;
				this.queueProcessor
					.processBatch()
					.then((processed) => {
						if (processed > 0) this.lastActiveAt = Date.now();
					})
					.catch(() => {})
					.finally(() => {
						this.processing = false;
					});
			}
		}
	}
}
