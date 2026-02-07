// =============================================================================
// open-mem — Typed Event Bus for Repository Change Notifications
// =============================================================================

import { EventEmitter } from "node:events";
import type { Observation, Session, SessionSummary } from "../types";

// -----------------------------------------------------------------------------
// Event Type Definitions
// -----------------------------------------------------------------------------

export type MemoryEventMap = {
	"observation:created": Observation;
	"observation:updated": Observation;
	"session:started": Session;
	"session:ended": Session;
	"summary:created": SessionSummary;
	"pending:enqueued": number;
	"pending:processed": number;
};

export type MemoryEventName = keyof MemoryEventMap;

// -----------------------------------------------------------------------------
// Typed EventEmitter
// -----------------------------------------------------------------------------

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

export function createEventBus(): MemoryEventBus {
	return new EventEmitter() as MemoryEventBus;
}
