import { useCallback, useEffect, useRef, useState } from "react";
import { SearchResultCard } from "../components/SearchResult";
import type { SearchResult as SearchResultType } from "../types";

const typeOptions: Array<{ value: string; label: string }> = [
	{ value: "", label: "All types" },
	{ value: "decision", label: "\u{1F3AF} Decision" },
	{ value: "bugfix", label: "\u{1F41B} Bugfix" },
	{ value: "feature", label: "\u2728 Feature" },
	{ value: "refactor", label: "\u{1F527} Refactor" },
	{ value: "discovery", label: "\u{1F4A1} Discovery" },
	{ value: "change", label: "\u{1F4DD} Change" },
];

function useSearch() {
	const [results, setResults] = useState<SearchResultType[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [searched, setSearched] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const search = useCallback((debouncedQuery: string, selectedType: string) => {
		if (abortRef.current) {
			abortRef.current.abort();
		}

		if (debouncedQuery.length < 2) {
			setResults([]);
			setLoading(false);
			setSearched(false);
			return;
		}

		const controller = new AbortController();
		abortRef.current = controller;

		setLoading(true);
		setError(null);
		setSearched(true);

		const params = new URLSearchParams({ q: debouncedQuery, limit: "20" });
		if (selectedType) {
			params.set("type", selectedType);
		}

		fetch(`/v1/memory/search?${params.toString()}`, {
			signal: controller.signal,
			headers: { "Content-Type": "application/json" },
		})
			.then((response) => {
				if (!response.ok) {
					return response.text().then((text) => {
						throw new Error(text || `HTTP ${response.status}`);
					});
				}
				return response.json();
			})
			.then((json: SearchResultType[] | { data: SearchResultType[] }) => {
				if (!controller.signal.aborted) {
					setResults(Array.isArray(json) ? json : (json.data ?? []));
					setLoading(false);
				}
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === "AbortError") {
					return;
				}
				if (!controller.signal.aborted) {
					setError(err instanceof Error ? err.message : "Search failed");
					setLoading(false);
				}
			});
	}, []);

	useEffect(() => {
		return () => {
			if (abortRef.current) {
				abortRef.current.abort();
			}
		};
	}, []);

	return { results, loading, error, searched, search };
}

export function Search() {
	const [query, setQuery] = useState("");
	const [type, setType] = useState("");
	const { results, loading, error, searched, search } = useSearch();
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}

		timerRef.current = setTimeout(() => {
			search(query, type);
		}, 300);

		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, [query, type, search]);

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Search</h1>
				<p className="mt-1 text-sm text-stone-500">
					Full-text and semantic search across all observations
				</p>
			</div>

			<div className="mb-6 flex flex-col gap-3 sm:flex-row">
				<div className="relative flex-1">
					<svg
						className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search observations..."
						className="w-full rounded-xl border border-stone-200 bg-white py-3.5 pl-12 pr-10 text-sm text-stone-800 shadow-sm outline-none transition-all duration-150 placeholder:text-stone-400 focus:border-amber-300 focus:ring-2 focus:ring-amber-200/50"
					/>
					{query.length > 0 && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-stone-300 transition-colors hover:text-stone-500"
							aria-label="Clear search"
						>
							<svg
								className="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M6 18L18 6M6 6l12 12"
								/>
							</svg>
						</button>
					)}
				</div>

				<select
					value={type}
					onChange={(e) => setType(e.target.value)}
					className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow-sm outline-none transition-all duration-150 focus:border-amber-300 focus:ring-2 focus:ring-amber-200/50 sm:w-44"
				>
					{typeOptions.map((opt) => (
						<option key={opt.value} value={opt.value}>
							{opt.label}
						</option>
					))}
				</select>
			</div>

			{error && (
				<div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
					<p className="text-sm text-red-700">{error}</p>
				</div>
			)}

			{loading && (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="animate-pulse rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200/60"
						>
							<div className="flex items-start gap-3">
								<div className="h-7 w-7 rounded-lg bg-stone-100" />
								<div className="flex-1 space-y-2">
									<div className="h-4 w-2/3 rounded bg-stone-100" />
									<div className="h-3 w-1/3 rounded bg-stone-50" />
								</div>
							</div>
							<div className="mt-3 space-y-1.5">
								<div className="h-3 w-full rounded bg-stone-50" />
								<div className="h-3 w-4/5 rounded bg-stone-50" />
							</div>
						</div>
					))}
				</div>
			)}

			{!loading && !searched && (
				<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-20">
					<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
						<svg
							className="h-7 w-7 text-amber-500"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={1.5}
								d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
							/>
						</svg>
					</div>
					<h2 className="text-lg font-semibold text-stone-700">Search through your observations</h2>
					<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
						Type at least 2 characters to search across decisions, discoveries, bugfixes, and more.
					</p>
				</div>
			)}

			{!loading && searched && results.length === 0 && (
				<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-16">
					<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-2xl">
						{"\u{1F50E}"}
					</div>
					<h2 className="text-lg font-semibold text-stone-700">No results found</h2>
					<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
						No observations match &ldquo;{query}&rdquo;
						{type ? ` with type ${type}` : ""}. Try different keywords or remove the type filter.
					</p>
				</div>
			)}

			{!loading && results.length > 0 && (
				<div>
					<p className="mb-3 text-xs font-medium text-stone-400">
						{results.length} result{results.length !== 1 ? "s" : ""}
					</p>
					<div className="space-y-3">
						{results.map((result) => (
							<SearchResultCard key={result.observation.id} result={result} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}
