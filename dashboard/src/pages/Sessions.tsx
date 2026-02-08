import { useCallback, useState } from "react";
import { SessionCard } from "../components/SessionCard";
import { useAPI } from "../hooks/useAPI";
import type { Session } from "../types";

export function Sessions() {
	const { data: sessions, loading, error } = useAPI<Session[]>("/v1/memory/sessions?limit=20");
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const toggleSession = useCallback((id: string) => {
		setExpandedId((prev) => (prev === id ? null : id));
	}, []);

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Sessions</h1>
				<p className="mt-1 text-sm text-stone-500">Browse and inspect past coding sessions</p>
			</div>

			{loading && (
				<div className="flex flex-col items-center justify-center py-20">
					<svg
						className="mb-4 h-8 w-8 animate-spin text-amber-500"
						fill="none"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<circle
							className="opacity-25"
							cx="12"
							cy="12"
							r="10"
							stroke="currentColor"
							strokeWidth="4"
						/>
						<path
							className="opacity-75"
							fill="currentColor"
							d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
						/>
					</svg>
					<p className="text-sm text-stone-400">Loading sessions…</p>
				</div>
			)}

			{error && (
				<div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
					<p className="text-sm font-medium text-red-700">Failed to load sessions</p>
					<p className="mt-1 text-xs text-red-500">{error}</p>
				</div>
			)}

			{!loading && !error && sessions && sessions.length === 0 && (
				<div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white px-8 py-20">
					<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
						{"\u{1F4CB}"}
					</div>
					<h2 className="text-lg font-semibold text-stone-700">No sessions found</h2>
					<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
						Sessions will appear here once you start using open-mem with OpenCode.
					</p>
				</div>
			)}

			{!loading && !error && sessions && sessions.length > 0 && (
				<div className="space-y-3">
					{sessions.map((session) => (
						<SessionCard
							key={session.id}
							session={session}
							isExpanded={expandedId === session.id}
							onToggle={() => toggleSession(session.id)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
