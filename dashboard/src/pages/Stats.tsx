import { Alert } from "../components/ui/alert";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { useAPI } from "../hooks/useAPI";
import type { ObservationType, StatsResponse } from "../types";

const TYPE_META: Record<ObservationType, { icon: string; label: string; color: string }> = {
	bugfix: { icon: "\u{1F41B}", label: "Bugfix", color: "bg-red-400" },
	discovery: { icon: "\u{1F4A1}", label: "Discovery", color: "bg-amber-400" },
	refactor: { icon: "\u{1F527}", label: "Refactor", color: "bg-sky-400" },
	decision: { icon: "\u{1F3AF}", label: "Decision", color: "bg-violet-400" },
	feature: { icon: "\u2728", label: "Feature", color: "bg-emerald-400" },
	change: { icon: "\u{1F4DD}", label: "Change", color: "bg-stone-400" },
};

function formatNumber(n: number): string {
	return n.toLocaleString("en-US");
}

export function Stats() {
	const { data, loading, error } = useAPI<StatsResponse>("/v1/memory/stats");

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Stats</h1>
				<p className="mt-1 text-sm text-stone-500">
					Memory usage analytics and compression metrics
				</p>
			</div>

			{error && (
				<Alert variant="destructive" className="mb-6">
					<p className="font-medium">Failed to load stats</p>
					<p className="mt-1 text-xs opacity-80">{error}</p>
				</Alert>
			)}

			{loading && <LoadingSkeleton />}

			{!loading && !error && data && data.totalObservations === 0 && <EmptyState />}

			{!loading && !error && data && data.totalObservations > 0 && (
				<>
					<StatsCards data={data} />
					<TypeBreakdown breakdown={data.typeBreakdown} total={data.totalObservations} />
				</>
			)}
		</div>
	);
}

function StatsCards({ data }: { data: StatsResponse }) {
	const savingsPercent =
		data.totalTokensSaved > 0 && data.averageObservationSize > 0
			? Math.round(
					(data.totalTokensSaved /
						(data.totalTokensSaved + data.totalObservations * data.averageObservationSize)) *
						100,
				)
			: 0;

	const cards = [
		{
			icon: "\u{1F4CB}",
			label: "Total Observations",
			value: formatNumber(data.totalObservations),
			accent: "bg-amber-500/10 text-amber-600",
		},
		{
			icon: "\u{1F5C2}\uFE0F",
			label: "Total Sessions",
			value: formatNumber(data.totalSessions),
			accent: "bg-sky-500/10 text-sky-600",
		},
		{
			icon: "\u{1F4B0}",
			label: "Token Savings",
			value: formatNumber(data.totalTokensSaved),
			suffix: savingsPercent > 0 ? `${savingsPercent}% saved` : undefined,
			accent: "bg-emerald-500/10 text-emerald-600",
		},
		{
			icon: "\u{1F4CF}",
			label: "Avg Observation Size",
			value: formatNumber(data.averageObservationSize),
			suffix: "tokens",
			accent: "bg-violet-500/10 text-violet-600",
		},
	];

	return (
		<div
			className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2"
			role="group"
			aria-label="Memory statistics"
		>
			{cards.map((card) => (
				<Card
					key={card.label}
					className="group relative overflow-hidden transition-all duration-200 hover:shadow-md"
				>
					<CardContent className="p-5">
						<div className="absolute inset-0 bg-gradient-to-br from-stone-50/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
						<div className="relative">
							<div className="mb-3 flex items-center gap-2.5">
								<div
									className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${card.accent}`}
									aria-hidden="true"
								>
									{card.icon}
								</div>
								<span className="text-xs font-semibold tracking-wide text-stone-400 uppercase">
									{card.label}
								</span>
							</div>
							<div className="flex items-baseline gap-2">
								<span className="font-serif text-3xl font-medium text-stone-900 italic tabular-nums">
									{card.value}
								</span>
								{card.suffix && (
									<span className="text-xs font-medium text-stone-400">{card.suffix}</span>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function TypeBreakdown({
	breakdown,
	total,
}: {
	breakdown: Record<ObservationType, number>;
	total: number;
}) {
	const entries = Object.entries(breakdown)
		.filter(([, count]) => count > 0)
		.sort(([, a], [, b]) => b - a);

	if (entries.length === 0) return null;

	const maxCount = Math.max(...entries.map(([, count]) => count));

	return (
		<Card>
			<CardHeader>
				<h2 className="font-serif text-lg text-stone-800 italic">Type Breakdown</h2>
			</CardHeader>

			<div className="divide-y divide-stone-100">
				{entries.map(([type, count]) => {
					const meta = TYPE_META[type as ObservationType];
					const pct = total > 0 ? Math.round((count / total) * 100) : 0;
					const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;

					return (
						<div key={type} className="group flex items-center gap-4 px-5 py-3.5">
							<div className="flex w-8 items-center justify-center text-lg" aria-hidden="true">
								{meta?.icon ?? "\u2753"}
							</div>
							<div className="w-24 text-sm font-medium text-stone-700">{meta?.label ?? type}</div>
							<div className="relative flex-1">
								<div
									className="h-2 overflow-hidden rounded-full bg-stone-100"
									role="progressbar"
									aria-valuenow={pct}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-label={`${meta?.label ?? type}: ${pct}%`}
								>
									<div
										className={`h-full rounded-full transition-all duration-500 ${meta?.color ?? "bg-stone-300"}`}
										style={{ width: `${barWidth}%` }}
									/>
								</div>
							</div>
							<div className="w-12 text-right text-sm font-semibold text-stone-700 tabular-nums">
								{formatNumber(count)}
							</div>
							<div className="w-12 text-right text-xs text-stone-400 tabular-nums">{pct}%</div>
						</div>
					);
				})}
			</div>
		</Card>
	);
}

function LoadingSkeleton() {
	return (
		<>
			<div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
				{Array.from({ length: 4 }, (_, i) => (
					<Card key={`card-skeleton-${i}`} className="p-5">
						<div className="mb-3 flex items-center gap-2.5">
							<Skeleton className="h-9 w-9 rounded-lg" />
							<Skeleton className="h-3 w-28" />
						</div>
						<Skeleton className="h-8 w-20" />
					</Card>
				))}
			</div>
			<Card>
				<CardHeader>
					<Skeleton className="h-5 w-36" />
				</CardHeader>
				{Array.from({ length: 4 }, (_, i) => (
					<div
						key={`row-skeleton-${i}`}
						className="flex items-center gap-4 border-b border-stone-100 px-5 py-3.5 last:border-b-0"
					>
						<Skeleton className="h-6 w-8" />
						<Skeleton className="h-4 w-20" />
						<Skeleton className="h-2 flex-1 rounded-full" />
						<Skeleton className="h-4 w-10" />
					</div>
				))}
			</Card>
		</>
	);
}

function EmptyState() {
	return (
		<Card className="border-dashed border-stone-300">
			<div className="flex flex-col items-center justify-center px-8 py-20">
				<div
					className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-2xl"
					aria-hidden="true"
				>
					{"\u{1F4CA}"}
				</div>
				<h2 className="text-lg font-semibold text-stone-700">No stats available yet</h2>
				<p className="mt-2 max-w-sm text-center text-sm text-stone-400">
					Stats will populate as observations are captured during your coding sessions.
				</p>
			</div>
		</Card>
	);
}
