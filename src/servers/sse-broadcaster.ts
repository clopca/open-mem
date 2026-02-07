// =============================================================================
// open-mem — SSE Broadcaster for Real-Time Dashboard Updates
// =============================================================================

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { MemoryEventBus, MemoryEventMap, MemoryEventName } from "../events/bus";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Writer function that sends an SSE event to a connected client */
export type SSEWriter = (event: string, data: string) => void | Promise<void>;

// -----------------------------------------------------------------------------
// SSE Broadcaster
// -----------------------------------------------------------------------------

/**
 * Bridges the MemoryEventBus to connected SSE clients.
 * Subscribes to all event bus events and broadcasts them to every connected
 * client writer in real time.
 */
export class SSEBroadcaster {
	private clients = new Set<SSEWriter>();
	private cleanups: Array<() => void> = [];

	constructor(private eventBus: MemoryEventBus) {
		this.subscribeToAll();
	}

	addClient(writer: SSEWriter): void {
		this.clients.add(writer);
	}

	removeClient(writer: SSEWriter): void {
		this.clients.delete(writer);
	}

	get clientCount(): number {
		return this.clients.size;
	}

	destroy(): void {
		for (const cleanup of this.cleanups) {
			cleanup();
		}
		this.cleanups = [];
		this.clients.clear();
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private subscribeToAll(): void {
		const eventNames: MemoryEventName[] = [
			"observation:created",
			"observation:updated",
			"session:started",
			"session:ended",
			"summary:created",
			"pending:enqueued",
			"pending:processed",
		];

		for (const eventName of eventNames) {
			const listener = (payload: MemoryEventMap[typeof eventName]) => {
				this.broadcast(eventName, payload);
			};
			this.eventBus.on(eventName, listener);
			this.cleanups.push(() => {
				this.eventBus.off(eventName, listener);
			});
		}
	}

	private broadcast(eventName: string, data: unknown): void {
		const json = JSON.stringify(data);
		for (const writer of this.clients) {
			try {
				const result = writer(eventName, json);
				// If the writer returned a promise, catch its rejection
				if (result && typeof result.catch === "function") {
					result.catch(() => this.clients.delete(writer));
				}
			} catch {
				this.clients.delete(writer);
			}
		}
	}
}

// -----------------------------------------------------------------------------
// Hono SSE Route
// -----------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Creates a Hono route handler for `GET /api/events` that streams SSE events
 * from the broadcaster to connected clients.
 */
export function createSSERoute(broadcaster: SSEBroadcaster) {
	return (c: Context) => {
		return streamSSE(c, async (stream) => {
			const writer: SSEWriter = (event: string, data: string) => {
				stream.writeSSE({ event, data, id: Date.now().toString() });
			};

			broadcaster.addClient(writer);

			const heartbeat = setInterval(() => {
				stream.writeSSE({
					event: "heartbeat",
					data: "",
					id: Date.now().toString(),
				});
			}, HEARTBEAT_INTERVAL_MS);

			stream.onAbort(() => {
				broadcaster.removeClient(writer);
				clearInterval(heartbeat);
			});

			while (!stream.aborted) {
				await stream.sleep(1000);
			}
		});
	};
}
