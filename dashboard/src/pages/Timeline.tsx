import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TimelineItem } from "../components/TimelineItem";
import { useAPI } from "../hooks/useAPI";
import { useSSE } from "../hooks/useSSE";
import type { Observation } from "../types";

interface SSEEvent {
	type: string;
	data: Observation;
}

const FILTER_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: "", label: "All types" },
	{ value: "decision", label: "\u{1F3AF} Decision" },
	{ value: "bugfix", label: "\u{1F41B} Bugfix" },
	{ value: "feature", label: "\u2728 Feature" },
	{ value: "refactor", label: "\u{1F527} Refactor" },
	{ value: "discovery", label: "\u{1F4A1} Discovery" },
	{ value: "change", label: "\u{1F4DD} Change" },
];

const PAGE_SIZE = 50;

export function Timeline() {
	const [typeFilter, setTypeFilter] = useState("");
	const [offset, setOffset] = useState(0);
	const [allObservations, setAllObservations] = useState<Observation[]>([]);
	const [hasMore, setHasMore] = useState(true);
	const [newIds, setNewIds] = useState<Set<string>>(new Set());
	const newIdTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

	const apiUrl = useMemo(
		() =>
			`/api/observations?limit=${PAGE_SIZE}&offset=${offset}${typeFilter ? `&type=${typeFilter}` : ""}`,
		[offset, typeFilter],
	);
	const { data, loading, error } = useAPI<Observation[]>(apiUrl);

	const { events, clearEvents } = useSSE<SSEEvent>("/api/events");
	const processedEventCount = useRef(0);

	useEffect(() => {
		if (!data) return;

		if (offset === 0) {
			setAllObservations(data);
		} else {
			setAllObservations((prev) => {
				const existingIds = new Set(prev.map((o) => o.id));
				const newItems = data.filter((o) => !existingIds.has(o.id));
				return [...prev, ...newItems];
			});
		}

		setHasMore(data.length === PAGE_SIZE);
	}, [data, offset]);

	useEffect(() => {
		if (events.length <= processedEventCount.current) return;

		const newEvents = events.slice(processedEventCount.current);
		processedEventCount.current = events.length;

		const incomingObservations: Observation[] = [];
		for (const event of newEvents) {
			if (event.type !== "observation:created") continue;
			if (typeFilter && event.data.type !== typeFilter) continue;
			incomingObservations.push(event.data);
		}

		if (incomingObservations.length === 0) return;

		setAllObservations((prev) => {
			const existingIds = new Set(prev.map((o) => o.id));
			const unique = incomingObservations.filter((o) => !existingIds.has(o.id));
			return [...unique, ...prev];
		});

		const incomingIds = new Set(incomingObservations.map((o) => o.id));
		setNewIds((prev) => new Set([...prev, ...incomingIds]));

		for (const id of incomingIds) {
			const existing = newIdTimers.current.get(id);
			if (existing) clearTimeout(existing);
			newIdTimers.current.set(
				id,
				setTimeout(() => {
					setNewIds((prev) => {
						const next = new Set(prev);
						next.delete(id);
						return next;
					});
					newIdTimers.current.delete(id);
				}, 2000),
			);
		}

		// Clear processed events to prevent unbounded memory growth
		clearEvents();
		processedEventCount.current = 0;
	}, [events, typeFilter, clearEvents]);

	useEffect(() => {
		return () => {
			for (const timer of newIdTimers.current.values()) {
				clearTimeout(timer);
			}
		};
	}, []);

	const handleFilterChange = useCallback((value: string) => {
		setTypeFilter(value);
		setOffset(0);
		setAllObservations([]);
		setHasMore(true);
		// Clear highlight state and cancel pending timers
		setNewIds(new Set());
		for (const timer of newIdTimers.current.values()) {
			clearTimeout(timer);
		}
		newIdTimers.current.clear();
	}, []);

	const handleLoadMore = useCallback(() => {
		setOffset((prev) => prev + PAGE_SIZE);
	}, []);

	const isInitialLoad = loading && offset === 0 && allObservations.length === 0;
	const isLoadingMore = loading && offset > 0;

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="font-serif text-3xl text-stone-900 italic">Timeline</h1>
					<p className="mt-1 text-sm text-stone-500">Observation feed across all sessions</p>
				</div>

				<div className="relative">
					<select
						value={typeFilter}
						onChange={(e) => handleFilterChange(e.target.value)}
						className="appearance-none rounded-lg border border-stone-200 bg-white py-2 pr-9 pl-3 text-sm font-medium text-stone-700 shadow-sm transition-colors hover:border-stone-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 focus:outline-none"
					>
						{FILTER_OPTIONS.map((opt) => (
							<option key={opt.value} value={opt.value}>
								{opt.label}
							</option>
						))}
					</select>
					<svg
						className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-stone-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</div>
			</div>

			{error && (
				<div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
					<p className="text-sm font-medium text-red-700">Failed to load observations</p>
					<p className="mt-1 text-xs text-red-500">{error}</p>
				</div>
			)}

			{isInitialLoad && <LoadingSkeleton />}

			{!isInitialLoad && !loading && allObservations.length === 0 && !error && (
				<EmptyState filtered={!!typeFilter} />
			)}

			{allObservations.length > 0 && (
				<div className="timeline-container relative ml-1.5 border-l-2 border-stone-200 pb-8">
					<div className="space-y-4">
						{allObservations.map((obs) => (
							<TimelineItem key={obs.id} observation={obs} isNew={newIds.has(obs.id)} />
						))}
					</div>

					{isLoadingMore && (
						<div className="mt-6 flex justify-center">
							<div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-amber-500" />
						</div>
					)}

					{hasMore && !loading && (
						<div className="mt-6 flex justify-center">
							<button
								type="button"
								onClick={handleLoadMore}
								className="rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:border-stone-300 hover:bg-stone-50 hover:shadow-md active:scale-[0.98]"
							>
								Load more
							</button>
						</div>
					)}

					{!hasMore && allObservations.length > 0 && (
						<div className="mt-6 flex justify-center">
							<span className="text-xs text-stone-300">End of timeline</span>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="relative ml-1.5 border-l-2 border-stone-200 pb-8">
			<div className="space-y-4">
				{Array.from({ length: 5 }, (_, i) => (
					<div key={`skeleton-${i}`} className="relative pl-8">
						<div className="absolute left-0 top-3 z-10 h-3 w-3 rounded-full bg-stone-200 ring-[3px] ring-white" />
						<div className="animate-pulse rounded-xl border border-stone-200/80 bg-white p-5 shadow-sm">
							<div className="flex items-start gap-3">
								<div className="h-7 w-20 rounded-lg bg-stone-100" />
								<div className="flex-1 space-y-2">
									<div className="h-4 w-3/4 rounded bg-stone-100" />
									<div className="h-3 w-1/2 rounded bg-stone-50" />
								</div>
								<div className="h-3 w-16 rounded bg-stone-50" />
							</div>
							<div className="mt-3 h-3 w-24 rounded bg-stone-50" />
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function EmptyState({ filtered }: { filtered: boolean }) {
	return (
		<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-20">
			<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
				{filtered ? "\u{1F50D}" : "\u{1F550}"}
			</div>
			<h2 className="text-lg font-semibold text-stone-700">
				{filtered ? "No matching observations" : "No observations yet"}
			</h2>
			<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
				{filtered
					? "Try a different filter or wait for new observations to arrive."
					: "Observations will appear here as your coding sessions generate them."}
			</p>
		</div>
	);
}
