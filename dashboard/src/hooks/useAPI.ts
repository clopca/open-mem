import { useCallback, useEffect, useRef, useState } from "react";

interface APIState<T> {
	data: T | null;
	loading: boolean;
	error: string | null;
	refetch: () => void;
}

export function useAPI<T>(url: string): APIState<T> {
	const [data, setData] = useState<T | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [fetchCount, setFetchCount] = useState(0);
	const abortRef = useRef<AbortController | null>(null);

	const refetch = useCallback(() => {
		setFetchCount((c) => c + 1);
	}, []);

	useEffect(() => {
		const controller = new AbortController();
		abortRef.current = controller;

		async function fetchData() {
			setLoading(true);
			setError(null);

			try {
				const response = await fetch(url, {
					signal: controller.signal,
					headers: { "Content-Type": "application/json" },
				});

				if (!response.ok) {
					const text = await response.text();
					throw new Error(text || `HTTP ${response.status}`);
				}

				const json = (await response.json()) as T;
				if (!controller.signal.aborted) {
					setData(json);
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === "AbortError") {
					return;
				}
				if (!controller.signal.aborted) {
					setError(err instanceof Error ? err.message : "An unknown error occurred");
				}
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			}
		}

		fetchData();

		return () => {
			controller.abort();
		};
	}, [url, fetchCount]);

	return { data, loading, error, refetch };
}
