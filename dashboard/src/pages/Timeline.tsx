import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TimelineItem } from "../components/TimelineItem";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { useAPI } from "../hooks/useAPI";
import { useSSE } from "../hooks/useSSE";
import type { Observation } from "../types";

interface SSEEvent {
	type: string;
	data: Observation;
}

type StateFilter = "current" | "superseded" | "tombstoned" | "";

const TYPE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
	{ value: "", label: "All types" },
	{ value: "decision", label: "\u{1F3AF} Decision" },
	{ value: "bugfix", label: "\u{1F41B} Bugfix" },
	{ value: "feature", label: "\u2728 Feature" },
	{ value: "refactor", label: "\u{1F527} Refactor" },
	{ value: "discovery", label: "\u{1F4A1} Discovery" },
	{ value: "change", label: "\u{1F4DD} Change" },
];

const STATE_FILTER_OPTIONS: Array<{ value: StateFilter; label: string }> = [
	{ value: "", label: "All states" },
	{ value: "current", label: "Current" },
	{ value: "superseded", label: "Superseded" },
	{ value: "tombstoned", label: "Tombstoned" },
];

const PAGE_SIZE = 50;

function getObservationState(obs: Observation): "current" | "superseded" | "tombstoned" {
	if (obs.deletedAt) return "tombstoned";
	if (obs.supersededBy) return "superseded";
	return "current";
}

export function Timeline() {
	const [typeFilter, setTypeFilter] = useState("");
	const [stateFilter, setStateFilter] = useState<StateFilter>("");
	const [sessionFilter, setSessionFilter] = useState("");
	const [dateFrom, setDateFrom] = useState("");
	const [dateTo, setDateTo] = useState("");
	const [offset, setOffset] = useState(0);
	const [allObservations, setAllObservations] = useState<Observation[]>([]);
	const [hasMore, setHasMore] = useState(true);
	const [newIds, setNewIds] = useState<Set<string>>(new Set());
	const newIdTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
	const parentRef = useRef<HTMLDivElement>(null);

	const apiUrl = useMemo(
		() =>
			`/v1/memory/observations?limit=${PAGE_SIZE}&offset=${offset}${typeFilter ? `&type=${typeFilter}` : ""}`,
		[offset, typeFilter],
	);
	const { data, loading, error } = useAPI<Observation[]>(apiUrl);

	const { events, clearEvents } = useSSE<SSEEvent>("/v1/events");
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

	const filteredObservations = useMemo(() => {
		let result = allObservations;

		if (stateFilter) {
			result = result.filter((obs) => getObservationState(obs) === stateFilter);
		}

		if (sessionFilter) {
			const lower = sessionFilter.toLowerCase();
			result = result.filter((obs) => obs.sessionId.toLowerCase().includes(lower));
		}

		if (dateFrom) {
			const fromDate = new Date(dateFrom);
			result = result.filter((obs) => new Date(obs.createdAt) >= fromDate);
		}

		if (dateTo) {
			const toDate = new Date(dateTo);
			toDate.setUTCHours(23, 59, 59, 999);
			result = result.filter((obs) => new Date(obs.createdAt) <= toDate);
		}

		return result;
	}, [allObservations, stateFilter, sessionFilter, dateFrom, dateTo]);

	const virtualizer = useVirtualizer({
		count: filteredObservations.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 120,
		overscan: 5,
	});

	const handleFilterChange = useCallback((value: string) => {
		setTypeFilter(value);
		setOffset(0);
		setAllObservations([]);
		setHasMore(true);
		setNewIds(new Set());
		for (const timer of newIdTimers.current.values()) {
			clearTimeout(timer);
		}
		newIdTimers.current.clear();
	}, []);

	const handleLoadMore = useCallback(() => {
		setOffset((prev) => prev + PAGE_SIZE);
	}, []);

	const activeFilterCount = [typeFilter, stateFilter, sessionFilter, dateFrom, dateTo].filter(
		Boolean,
	).length;

	const isInitialLoad = loading && offset === 0 && allObservations.length === 0;
	const isLoadingMore = loading && offset > 0;

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="font-serif text-3xl text-stone-900 italic">Timeline</h1>
					<p className="mt-1 text-sm text-stone-500">Observation feed across all sessions</p>
				</div>

				{activeFilterCount > 0 && (
					<Badge variant="warning">
						{activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active
					</Badge>
				)}
			</div>

			<Card className="mb-6">
				<div className="flex flex-wrap items-end gap-3 p-4">
					<div className="min-w-[140px]">
						<label
							className="mb-1 block text-[11px] font-medium text-stone-500 uppercase"
							htmlFor="timeline-type-filter"
						>
							Type
						</label>
						<Select
							id="timeline-type-filter"
							value={typeFilter}
							onChange={(e) => handleFilterChange(e.target.value)}
							aria-label="Filter by observation type"
						>
							{TYPE_FILTER_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</Select>
					</div>

					<div className="min-w-[140px]">
						<label
							className="mb-1 block text-[11px] font-medium text-stone-500 uppercase"
							htmlFor="timeline-state-filter"
						>
							State
						</label>
						<Select
							id="timeline-state-filter"
							value={stateFilter}
							onChange={(e) => setStateFilter(e.target.value as StateFilter)}
							aria-label="Filter by observation state"
						>
							{STATE_FILTER_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</Select>
					</div>

					<div className="min-w-[140px]">
						<label
							className="mb-1 block text-[11px] font-medium text-stone-500 uppercase"
							htmlFor="timeline-session-filter"
						>
							Session
						</label>
						<Input
							id="timeline-session-filter"
							type="text"
							value={sessionFilter}
							onChange={(e) => setSessionFilter(e.target.value)}
							placeholder="Session ID..."
							aria-label="Filter by session ID"
						/>
					</div>

					<div className="min-w-[130px]">
						<label
							className="mb-1 block text-[11px] font-medium text-stone-500 uppercase"
							htmlFor="timeline-date-from"
						>
							From
						</label>
						<Input
							id="timeline-date-from"
							type="date"
							value={dateFrom}
							onChange={(e) => setDateFrom(e.target.value)}
							aria-label="Filter from date"
						/>
					</div>

					<div className="min-w-[130px]">
						<label
							className="mb-1 block text-[11px] font-medium text-stone-500 uppercase"
							htmlFor="timeline-date-to"
						>
							To
						</label>
						<Input
							id="timeline-date-to"
							type="date"
							value={dateTo}
							onChange={(e) => setDateTo(e.target.value)}
							aria-label="Filter to date"
						/>
					</div>

					{activeFilterCount > 0 && (
						<Button
							variant="ghost"
							className="text-xs"
							onClick={() => {
								handleFilterChange("");
								setStateFilter("");
								setSessionFilter("");
								setDateFrom("");
								setDateTo("");
							}}
							aria-label="Clear all filters"
						>
							Clear all
						</Button>
					)}
				</div>
			</Card>

			{error && (
				<Alert variant="destructive" className="mb-6">
					<p className="font-medium">Failed to load observations</p>
					<p className="mt-1 text-xs opacity-80">{error}</p>
				</Alert>
			)}

			{allObservations.length >= 1000 && (dateFrom || dateTo) && (
				<Alert variant="warning" className="mb-6">
					Showing filtered results from the first {allObservations.length} observations. Some
					matching items may not be visible.
				</Alert>
			)}

			{isInitialLoad && <LoadingSkeleton />}

			{!isInitialLoad && !loading && filteredObservations.length === 0 && !error && (
				<EmptyState
					filtered={!!(typeFilter || stateFilter || sessionFilter || dateFrom || dateTo)}
				/>
			)}

			{filteredObservations.length > 0 && (
				<div
					ref={parentRef}
					className="timeline-container relative ml-1.5 border-l-2 border-stone-200 pb-8"
					style={{ maxHeight: "calc(100vh - 320px)", overflowY: "auto" }}
					role="feed"
					aria-label="Observation timeline"
				>
					<div
						style={{
							height: `${virtualizer.getTotalSize()}px`,
							width: "100%",
							position: "relative",
						}}
					>
						{virtualizer.getVirtualItems().map((virtualItem) => {
							const obs = filteredObservations[virtualItem.index];
							if (!obs) return null;
							return (
								<div
									key={obs.id}
									style={{
										position: "absolute",
										top: 0,
										left: 0,
										width: "100%",
										transform: `translateY(${virtualItem.start}px)`,
									}}
									data-index={virtualItem.index}
									ref={virtualizer.measureElement}
								>
									<div className="pb-4">
										<TimelineItem observation={obs} isNew={newIds.has(obs.id)} />
									</div>
								</div>
							);
						})}
					</div>

					{isLoadingMore && (
						<div
							className="mt-6 flex justify-center"
							role="status"
							aria-label="Loading more observations"
						>
							<Skeleton className="h-5 w-5 rounded-full" />
						</div>
					)}

					{hasMore && !loading && (
						<div className="mt-6 flex justify-center">
							<Button
								variant="outline"
								onClick={handleLoadMore}
								aria-label="Load more observations"
							>
								Load more
							</Button>
						</div>
					)}

					{!hasMore && filteredObservations.length > 0 && (
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
						<Skeleton className="absolute left-0 top-3 z-10 h-3 w-3 rounded-full" />
						<Card className="p-5">
							<div className="flex items-start gap-3">
								<Skeleton className="h-7 w-20 rounded-lg" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
								<Skeleton className="h-3 w-16" />
							</div>
							<Skeleton className="mt-3 h-3 w-24" />
						</Card>
					</div>
				))}
			</div>
		</div>
	);
}

function EmptyState({ filtered }: { filtered: boolean }) {
	return (
		<Card className="border-dashed border-stone-300">
			<div className="flex flex-col items-center justify-center px-8 py-20">
				<div
					className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl"
					aria-hidden="true"
				>
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
		</Card>
	);
}
