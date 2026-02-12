import type { Observation, ObservationType } from "../types";

/** Filter criteria for narrowing observation search results. */
export interface ObservationFilterOptions {
	type?: ObservationType;
	importanceMin?: number;
	importanceMax?: number;
	createdAfter?: string;
	createdBefore?: string;
	concepts?: string[];
	files?: string[];
}

/** Check whether an observation passes all specified filter criteria. */
export function passesFilters(obs: Observation, filters: ObservationFilterOptions): boolean {
	if (filters.type && obs.type !== filters.type) return false;
	if (filters.importanceMin !== undefined && obs.importance < filters.importanceMin) return false;
	if (filters.importanceMax !== undefined && obs.importance > filters.importanceMax) return false;
	if (filters.createdAfter && obs.createdAt < filters.createdAfter) return false;
	if (filters.createdBefore && obs.createdAt > filters.createdBefore) return false;
	if (filters.concepts && filters.concepts.length > 0) {
		const hasConcept = filters.concepts.some((c) =>
			obs.concepts.some((oc) => oc.toLowerCase().includes(c.toLowerCase())),
		);
		if (!hasConcept) return false;
	}
	if (filters.files && filters.files.length > 0) {
		const allFiles = [...obs.filesRead, ...obs.filesModified];
		const hasFile = filters.files.some((f) =>
			allFiles.some((af) => af.toLowerCase().includes(f.toLowerCase())),
		);
		if (!hasFile) return false;
	}
	return true;
}
