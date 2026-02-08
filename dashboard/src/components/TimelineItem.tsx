import { useEffect, useState } from "react";
import type { LineageNode, Observation, ObservationLineageResponse, ObservationType } from "../types";

const TYPE_ICONS: Record<ObservationType, string> = {
	bugfix: "\u{1F41B}",
	discovery: "\u{1F4A1}",
	refactor: "\u{1F527}",
	decision: "\u{1F3AF}",
	feature: "\u2728",
	change: "\u{1F4DD}",
};

const TYPE_COLORS: Record<ObservationType, string> = {
	bugfix: "bg-red-50 text-red-700 ring-red-200",
	discovery: "bg-violet-50 text-violet-700 ring-violet-200",
	refactor: "bg-sky-50 text-sky-700 ring-sky-200",
	decision: "bg-amber-50 text-amber-700 ring-amber-200",
	feature: "bg-emerald-50 text-emerald-700 ring-emerald-200",
	change: "bg-stone-100 text-stone-600 ring-stone-200",
};

const DOT_COLORS: Record<ObservationType, string> = {
	bugfix: "bg-red-400",
	discovery: "bg-violet-400",
	refactor: "bg-sky-400",
	decision: "bg-amber-500",
	feature: "bg-emerald-400",
	change: "bg-stone-400",
};

function relativeTime(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const diffMs = now - then;
	const diffSec = Math.floor(diffMs / 1000);

	if (diffSec < 5) return "just now";
	if (diffSec < 60) return `${diffSec}s ago`;

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin} min ago`;

	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;

	const diffDay = Math.floor(diffHr / 24);
	if (diffDay < 30) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;

	const diffMonth = Math.floor(diffDay / 30);
	return `${diffMonth} month${diffMonth > 1 ? "s" : ""} ago`;
}

function truncateId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}...` : id;
}

interface TimelineItemProps {
	observation: Observation;
	isNew?: boolean;
}

export function TimelineItem({ observation, isNew }: TimelineItemProps) {
	const [expanded, setExpanded] = useState(false);
	const [lineage, setLineage] = useState<LineageNode[] | null>(null);
	const [lineageError, setLineageError] = useState<string | null>(null);
	const icon = TYPE_ICONS[observation.type] ?? "\u{1F4DD}";
	const colorClasses = TYPE_COLORS[observation.type] ?? TYPE_COLORS.change;
	const dotColor = DOT_COLORS[observation.type] ?? DOT_COLORS.change;

	const hasExpandableContent =
		observation.narrative ||
		observation.facts.length > 0 ||
		observation.concepts.length > 0 ||
		observation.filesRead.length > 0 ||
		observation.filesModified.length > 0;

	useEffect(() => {
		if (!expanded || lineage || lineageError) return;
		let cancelled = false;

		fetch(`/v1/memory/observations/${observation.id}/lineage`, {
			headers: { "Content-Type": "application/json" },
		})
			.then((response) => {
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				return response.json();
			})
			.then((json) => {
				if (cancelled) return;
				const data = (json as { data?: ObservationLineageResponse }).data;
				setLineage(data?.lineage ?? []);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setLineageError(err instanceof Error ? err.message : "Unable to load lineage");
			});

		return () => {
			cancelled = true;
		};
	}, [expanded, lineage, lineageError, observation.id]);

	return (
		<div className={`timeline-item relative pl-8 ${isNew ? "timeline-item-new" : ""}`}>
			<div
				className={`absolute left-0 top-3 z-10 h-3 w-3 rounded-full ring-[3px] ring-white ${dotColor}`}
				aria-hidden="true"
			/>

			<div className="group rounded-xl border border-stone-200/80 bg-white shadow-sm transition-all duration-200 hover:shadow-md">
				<button
					type="button"
					onClick={() => hasExpandableContent && setExpanded(!expanded)}
					className={`w-full px-5 py-4 text-left ${hasExpandableContent ? "cursor-pointer" : "cursor-default"}`}
				>
					<div className="flex items-start gap-3">
						<span
							className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${colorClasses}`}
						>
							<span className="text-sm">{icon}</span>
							{observation.type}
						</span>

						<div className="min-w-0 flex-1">
							<h3 className="text-sm font-semibold leading-snug text-stone-900">{observation.title}</h3>
							{observation.subtitle && (
								<p className="mt-0.5 truncate text-xs text-stone-400">{observation.subtitle}</p>
							)}
						</div>

						<div className="flex shrink-0 items-center gap-2">
							<time
								className="text-[11px] font-medium tabular-nums text-stone-400"
								dateTime={observation.createdAt}
								title={new Date(observation.createdAt).toLocaleString()}
							>
								{relativeTime(observation.createdAt)}
							</time>
							{hasExpandableContent && (
								<svg
									className={`h-4 w-4 text-stone-300 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
									aria-hidden="true"
								>
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
								</svg>
							)}
						</div>
					</div>

					<div className="mt-2 flex items-center gap-2">
						<span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-400">
							{truncateId(observation.sessionId)}
						</span>
						{observation.tokenCount > 0 && (
							<span className="text-[10px] text-stone-300">{observation.tokenCount} tokens</span>
						)}
					</div>
				</button>

				{expanded && hasExpandableContent && (
					<div className="border-t border-stone-100 px-5 py-4">
						{observation.narrative && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Narrative</h4>
								<p className="text-sm leading-relaxed text-stone-600">{observation.narrative}</p>
							</div>
						)}

						{observation.facts.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Facts</h4>
								<ul className="space-y-1">
									{observation.facts.map((fact, i) => (
										<li key={`${observation.id}-fact-${i}`} className="flex items-start gap-2 text-sm text-stone-600">
											<span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
											{fact}
										</li>
									))}
								</ul>
							</div>
						)}

						{observation.concepts.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Concepts</h4>
								<div className="flex flex-wrap gap-1.5">
									{observation.concepts.map((concept) => (
										<span
											key={`${observation.id}-concept-${concept}`}
											className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200/60"
										>
											{concept}
										</span>
									))}
								</div>
							</div>
						)}

						{observation.filesRead.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Files Read</h4>
								<div className="space-y-0.5">
									{observation.filesRead.map((file) => (
										<p key={`${observation.id}-read-${file}`} className="truncate font-mono text-xs text-stone-500">
											{file}
										</p>
									))}
								</div>
							</div>
						)}

						{observation.filesModified.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Files Modified</h4>
								<div className="space-y-0.5">
									{observation.filesModified.map((file) => (
										<p key={`${observation.id}-mod-${file}`} className="truncate font-mono text-xs text-amber-600">
											{file}
										</p>
									))}
								</div>
							</div>
						)}

						<div>
							<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">Lineage</h4>
							{lineageError && <p className="text-xs text-red-500">{lineageError}</p>}
							{!lineage && !lineageError && <p className="text-xs text-stone-400">Loading...</p>}
							{lineage && lineage.length > 0 && (
								<div className="space-y-1.5">
									{lineage.map((item) => (
										<div
											key={`${observation.id}-lineage-${item.id}`}
											className="flex items-center justify-between rounded border border-stone-200 bg-stone-50 px-2 py-1"
										>
											<div className="min-w-0">
												<p className="truncate text-xs font-medium text-stone-700">{item.observation.title}</p>
												<p className="text-[10px] text-stone-400">{new Date(item.observation.createdAt).toLocaleString()}</p>
											</div>
											<div className="ml-2 flex items-center gap-1">
												{item.state === "tombstoned" && (
													<span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">tombstoned</span>
												)}
												{item.state === "superseded" && (
													<span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">superseded</span>
												)}
												{item.state === "current" && (
													<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">current</span>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
