import { useCallback, useEffect, useRef, useState } from "react";

interface SSEState<T> {
	events: T[];
	connected: boolean;
	error: string | null;
}

export function useSSE<T = unknown>(
	url = "/v1/events",
): SSEState<T> & { clearEvents: () => void } {
	const [events, setEvents] = useState<T[]>([]);
	const [connected, setConnected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sourceRef = useRef<EventSource | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearEvents = useCallback(() => {
		setEvents([]);
	}, []);

	useEffect(() => {
		let cancelled = false;

		function connect() {
			if (cancelled) return;

			const source = new EventSource(url);
			sourceRef.current = source;

			source.onopen = () => {
				if (!cancelled) {
					setConnected(true);
					setError(null);
				}
			};

			source.onmessage = (event) => {
				if (cancelled) return;
				try {
					const data = JSON.parse(event.data) as T;
					setEvents((prev) => [...prev, data]);
				} catch {
					/* empty — non-JSON messages are ignored */
				}
			};

			source.onerror = () => {
				if (cancelled) return;
				setConnected(false);
				setError("Connection lost. Reconnecting...");
				source.close();

				// Auto-reconnect after 3 seconds
				reconnectTimeoutRef.current = setTimeout(() => {
					if (!cancelled) connect();
				}, 3000);
			};
		}

		connect();

		return () => {
			cancelled = true;
			sourceRef.current?.close();
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
		};
	}, [url]);

	return { events, connected, error, clearEvents };
}
