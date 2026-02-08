import { useCallback, useState } from "react";
import { SessionCard } from "../components/SessionCard";
import { Alert } from "../components/ui/alert";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
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
				<div className="space-y-3">
					{Array.from({ length: 4 }, (_, i) => (
						<Card key={`session-skeleton-${i}`} className="p-5">
							<div className="flex items-center gap-4">
								<Skeleton className="h-2.5 w-2.5 rounded-full" />
								<div className="flex-1 space-y-2">
									<div className="flex items-center gap-2.5">
										<Skeleton className="h-4 w-20" />
										<Skeleton className="h-5 w-16 rounded-full" />
									</div>
									<Skeleton className="h-3 w-48" />
								</div>
								<Skeleton className="h-5 w-5" />
							</div>
						</Card>
					))}
				</div>
			)}

			{error && (
				<Alert variant="destructive">
					<p className="font-medium">Failed to load sessions</p>
					<p className="mt-1 text-xs opacity-80">{error}</p>
				</Alert>
			)}

			{!loading && !error && sessions && sessions.length === 0 && (
				<Card className="border-dashed border-stone-300">
					<div className="flex flex-col items-center justify-center px-8 py-20">
						<div
							className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl"
							aria-hidden="true"
						>
							{"\u{1F4CB}"}
						</div>
						<h2 className="text-lg font-semibold text-stone-700">No sessions found</h2>
						<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
							Sessions will appear here once you start using open-mem with OpenCode.
						</p>
					</div>
				</Card>
			)}

			{!loading && !error && sessions && sessions.length > 0 && (
				<div className="space-y-3" role="list" aria-label="Coding sessions">
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
