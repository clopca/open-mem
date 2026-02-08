import type { ObservationRepository } from "../../db/observations";
import type { SessionRepository } from "../../db/sessions";
import type { SummaryRepository } from "../../db/summaries";
import type { UserObservationRepository } from "../../db/user-memory";
import type { ObservationStore, SessionStore, SummaryStore, UserObservationStore } from "../ports";

export function createObservationStore(repo: ObservationRepository): ObservationStore {
	return repo;
}

export function createSessionStore(repo: SessionRepository): SessionStore {
	return repo;
}

export function createSummaryStore(repo: SummaryRepository): SummaryStore {
	return repo;
}

export function createUserObservationStore(
	repo: UserObservationRepository | null,
): UserObservationStore | null {
	if (!repo) return null;
	return repo;
}
