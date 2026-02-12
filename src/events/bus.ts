// =============================================================================
// open-mem — Typed Event Bus for Repository Change Notifications
// =============================================================================

import { EventEmitter } from "node:events";
import type { Observation, Session, SessionSummary } from "../types";

// -----------------------------------------------------------------------------
// Event Type Definitions
// -----------------------------------------------------------------------------

/** Map of event names to their payload types. */
export type MemoryEventMap = {
	"observation:created": Observation;
	"observation:updated": Observation;
	"session:started": Session;
	"session:ended": Session;
	"summary:created": SessionSummary;
	"pending:enqueued": number;
	"pending:processed": number;
};

/** Union of all valid memory event names. */
export type MemoryEventName = keyof MemoryEventMap;

// -----------------------------------------------------------------------------
// Typed EventEmitter
// -----------------------------------------------------------------------------

/** Typed event emitter for memory repository change notifications. */
export interface MemoryEventBus {
	on<K extends MemoryEventName>(event: K, listener: (payload: MemoryEventMap[K]) => void): this;
	off<K extends MemoryEventName>(event: K, listener: (payload: MemoryEventMap[K]) => void): this;
	once<K extends MemoryEventName>(event: K, listener: (payload: MemoryEventMap[K]) => void): this;
	emit<K extends MemoryEventName>(event: K, payload: MemoryEventMap[K]): boolean;
	removeAllListeners(event?: MemoryEventName): this;
	listenerCount(event: MemoryEventName): number;
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

/** Create a new typed event bus backed by Node's EventEmitter. */
export function createEventBus(): MemoryEventBus {
	return new EventEmitter() as MemoryEventBus;
}
