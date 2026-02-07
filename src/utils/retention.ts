import type { ObservationRepository } from "../db/observations";
import type { PendingMessageRepository } from "../db/pending";
import type { OpenMemConfig } from "../types";

export function enforceRetention(
	config: OpenMemConfig,
	observations: ObservationRepository,
	pendingMessages: PendingMessageRepository,
): void {
	if (config.retentionDays === 0) return;

	try {
		const deletedObservations = observations.deleteOlderThan(config.retentionDays);
		const deletedPending = pendingMessages.deleteCompletedOlderThan(config.retentionDays);

		if (deletedObservations > 0 || deletedPending > 0) {
			console.log(
				`[open-mem] Retention: deleted ${deletedObservations} observations, ${deletedPending} pending messages`,
			);
		}
	} catch (error) {
		console.error("[open-mem] Retention enforcement error:", error);
	}
}
