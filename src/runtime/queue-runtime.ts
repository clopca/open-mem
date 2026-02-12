import type { QueueProcessor } from "../queue/processor";

export interface QueueRuntime {
	start(): void;
	stop(): void;
	setInProcess(): void;
	setEnqueueOnly(onEnqueue: () => void): void;
}

export function createQueueRuntime(queue: QueueProcessor): QueueRuntime {
	return {
		start: () => queue.start(),
		stop: () => {
			queue.setOnEnqueue(null);
			queue.stop();
		},
		setInProcess: () => {
			queue.setMode("in-process");
			queue.start();
		},
		setEnqueueOnly: (onEnqueue) => {
			queue.setMode("enqueue-only");
			queue.setOnEnqueue(onEnqueue);
		},
	};
}
