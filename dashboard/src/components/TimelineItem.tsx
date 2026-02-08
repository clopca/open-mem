import { useEffect, useState } from "react";
import type { Observation, ObservationLineageResponse, ObservationType } from "../types";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

const TYPE_ICONS: Record<ObservationType, string> = {
	bugfix: "\u{1F41B}",
	discovery: "\u{1F4A1}",
	refactor: "\u{1F527}",
	decision: "\u{1F3AF}",
	feature: "\u2728",
	change: "\u{1F4DD}",
};

const TYPE_BADGE_VARIANT: Record<
	ObservationType,
	"danger" | "warning" | "outline" | "success" | "muted" | "default"
> = {
	bugfix: "danger",
	discovery: "warning",
	refactor: "outline",
	decision: "default",
	feature: "success",
	change: "muted",
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
	const [lineage, setLineage] = useState<Observation[] | null>(null);
	const [lineageError, setLineageError] = useState<string | null>(null);
	const icon = TYPE_ICONS[observation.type] ?? "\u{1F4DD}";
	const dotColor = DOT_COLORS[observation.type] ?? DOT_COLORS.change;
	const badgeVariant = TYPE_BADGE_VARIANT[observation.type] ?? "muted";

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
		<article className={`timeline-item relative pl-8 ${isNew ? "timeline-item-new" : ""}`}>
			<div
				className={`absolute left-0 top-3 z-10 h-3 w-3 rounded-full ring-[3px] ring-white ${dotColor}`}
				aria-hidden="true"
			/>

			<Card className="group transition-all duration-200 hover:shadow-md">
				<button
					type="button"
					onClick={() => setExpanded(!expanded)}
					className="w-full px-5 py-4 text-left cursor-pointer"
					aria-expanded={expanded}
					aria-label={`${observation.type}: ${observation.title}`}
				>
					<div className="flex items-start gap-3">
						<Badge variant={badgeVariant} className="shrink-0 gap-1.5">
							<span className="text-sm" aria-hidden="true">
								{icon}
							</span>
							{observation.type}
						</Badge>

						<div className="min-w-0 flex-1">
							<h3 className="text-sm font-semibold leading-snug text-stone-900">
								{observation.title}
							</h3>
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
							<svg
								className={`h-4 w-4 text-stone-300 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M19 9l-7 7-7-7"
								/>
							</svg>
						</div>
					</div>

					<div className="mt-2 flex items-center gap-2">
						<Badge variant="muted" className="font-mono text-[10px]">
							{truncateId(observation.sessionId)}
						</Badge>
						{observation.tokenCount > 0 && (
							<span className="text-[10px] text-stone-300">{observation.tokenCount} tokens</span>
						)}
					</div>
				</button>

				{expanded && (
					<div className="border-t border-stone-100 px-5 py-4">
						{observation.narrative && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
									Narrative
								</h4>
								<p className="text-sm leading-relaxed text-stone-600">{observation.narrative}</p>
							</div>
						)}

						{observation.facts.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
									Facts
								</h4>
								<ul className="space-y-1">
									{observation.facts.map((fact, i) => (
										<li
											key={`${observation.id}-fact-${i}`}
											className="flex items-start gap-2 text-sm text-stone-600"
										>
											<span
												className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400"
												aria-hidden="true"
											/>
											{fact}
										</li>
									))}
								</ul>
							</div>
						)}

						{observation.concepts.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
									Concepts
								</h4>
								<div className="flex flex-wrap gap-1.5">
									{observation.concepts.map((concept) => (
										<Badge
											key={`${observation.id}-concept-${concept}`}
											variant="warning"
											className="rounded-full text-[11px]"
										>
											{concept}
										</Badge>
									))}
								</div>
							</div>
						)}

						{observation.filesRead.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
									Files Read
								</h4>
								<div className="space-y-0.5">
									{observation.filesRead.map((file) => (
										<p
											key={`${observation.id}-read-${file}`}
											className="truncate font-mono text-xs text-stone-500"
										>
											{file}
										</p>
									))}
								</div>
							</div>
						)}

						{observation.filesModified.length > 0 && (
							<div className="mb-4">
								<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
									Files Modified
								</h4>
								<div className="space-y-0.5">
									{observation.filesModified.map((file) => (
										<p
											key={`${observation.id}-mod-${file}`}
											className="truncate font-mono text-xs text-amber-600"
										>
											{file}
										</p>
									))}
								</div>
							</div>
						)}

						<div>
							<h4 className="mb-1.5 text-[10px] font-bold tracking-wider text-stone-400 uppercase">
								Lineage
							</h4>
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
												<p className="truncate text-xs font-medium text-stone-700">{item.title}</p>
												<p className="text-[10px] text-stone-400">
													{new Date(item.createdAt).toLocaleString()}
												</p>
											</div>
											<div className="ml-2 flex items-center gap-1">
												{item.deletedAt && (
													<Badge variant="danger" className="text-[10px]">
														tombstoned
													</Badge>
												)}
												{item.supersededBy && !item.deletedAt && (
													<Badge variant="warning" className="text-[10px]">
														superseded
													</Badge>
												)}
												{!item.supersededBy && !item.deletedAt && (
													<Badge variant="success" className="text-[10px]">
														current
													</Badge>
												)}
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					</div>
				)}
			</Card>
		</article>
	);
}
