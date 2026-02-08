import { useCallback, useState } from "react";
import { useAPI } from "../hooks/useAPI";
import type { Observation, ObservationType, Session } from "../types";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

interface SessionWithObservations extends Session {
	observations: Observation[];
}

const typeIcons: Record<ObservationType, string> = {
	decision: "\u{1F9ED}",
	bugfix: "\u{1F41B}",
	feature: "\u2728",
	refactor: "\u{1F527}",
	discovery: "\u{1F4A1}",
	change: "\u{1F504}",
};

const STATUS_BADGE_VARIANT: Record<Session["status"], "success" | "warning" | "muted"> = {
	active: "success",
	idle: "warning",
	completed: "muted",
};

const STATUS_LABELS: Record<Session["status"], string> = {
	active: "Active",
	idle: "Idle",
	completed: "Completed",
};

const STATUS_DOT: Record<Session["status"], string> = {
	active: "bg-emerald-400",
	idle: "bg-amber-400",
	completed: "bg-stone-400",
};

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
}

function formatRelativeTime(dateStr: string): string {
	const now = Date.now();
	const then = new Date(dateStr).getTime();
	const diffMs = now - then;
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays < 30) return `${diffDays}d ago`;
	return formatDate(dateStr);
}

function ObservationRow({
	observation,
	isExpanded,
	onToggle,
}: {
	observation: Observation;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="group">
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-stone-50"
				aria-expanded={isExpanded}
				aria-label={`${observation.type}: ${observation.title}`}
			>
				<span className="mt-0.5 text-sm" aria-hidden="true">
					{typeIcons[observation.type]}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate text-sm font-medium text-stone-700">{observation.title}</span>
						<span className="shrink-0 text-[11px] text-stone-400">
							{formatRelativeTime(observation.createdAt)}
						</span>
					</div>
					{observation.subtitle && (
						<p className="mt-0.5 truncate text-xs text-stone-400">{observation.subtitle}</p>
					)}
				</div>
				<svg
					className={`mt-1 h-4 w-4 shrink-0 text-stone-300 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{isExpanded && (
				<div className="ml-9 mr-3 mb-2 rounded-lg border border-stone-100 bg-stone-50/50 p-3">
					{observation.narrative && (
						<p className="mb-3 text-sm leading-relaxed text-stone-600">{observation.narrative}</p>
					)}

					{observation.facts.length > 0 && (
						<div className="mb-3">
							<h4 className="mb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
								Key Facts
							</h4>
							<ul className="space-y-1">
								{observation.facts.map((fact, i) => (
									<li
										key={`${observation.id}-fact-${i}`}
										className="flex items-start gap-2 text-xs text-stone-500"
									>
										<span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
										{fact}
									</li>
								))}
							</ul>
						</div>
					)}

					{observation.concepts.length > 0 && (
						<div className="flex flex-wrap gap-1.5">
							{observation.concepts.map((concept) => (
								<Badge
									key={`${observation.id}-${concept}`}
									variant="warning"
									className="rounded-full text-[11px]"
								>
									{concept}
								</Badge>
							))}
						</div>
					)}

					{(observation.filesModified.length > 0 || observation.filesRead.length > 0) && (
						<div className="mt-2 border-t border-stone-100 pt-2">
							<h4 className="mb-1 text-[11px] font-semibold tracking-wider text-stone-400 uppercase">
								Files
							</h4>
							<div className="flex flex-wrap gap-1">
								{observation.filesModified.map((f) => (
									<Badge
										key={`${observation.id}-mod-${f}`}
										variant="warning"
										className="font-mono text-[10px]"
									>
										{f.split("/").pop()}
									</Badge>
								))}
								{observation.filesRead
									.filter((f) => !observation.filesModified.includes(f))
									.map((f) => (
										<Badge
											key={`${observation.id}-read-${f}`}
											variant="muted"
											className="font-mono text-[10px]"
										>
											{f.split("/").pop()}
										</Badge>
									))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ExpandedObservations({ sessionId }: { sessionId: string }) {
	const {
		data: details,
		loading,
		error,
	} = useAPI<SessionWithObservations>(`/v1/memory/sessions/${sessionId}`);
	const [expandedObsId, setExpandedObsId] = useState<string | null>(null);

	const toggleObs = useCallback((id: string) => {
		setExpandedObsId((prev) => (prev === id ? null : id));
	}, []);

	if (loading) {
		return (
			<div
				role="status"
				aria-live="polite"
				className="flex items-center justify-center py-8"
				aria-label="Loading observations"
			>
				<div className="flex items-center gap-3 text-sm text-stone-400">
					<Skeleton className="h-4 w-4 rounded-full" />
					Loading observations…
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div role="alert" className="py-8 text-center text-sm text-red-500">
				Failed to load observations: {error}
			</div>
		);
	}

	if (!details?.observations || details.observations.length === 0) {
		return (
			<div className="py-8 text-center text-sm text-stone-400">
				No observations recorded for this session
			</div>
		);
	}

	return (
		<div className="divide-y divide-stone-50 px-2 py-1">
			{details.observations.map((obs) => (
				<ObservationRow
					key={obs.id}
					observation={obs}
					isExpanded={expandedObsId === obs.id}
					onToggle={() => toggleObs(obs.id)}
				/>
			))}
		</div>
	);
}

export function SessionCard({
	session,
	isExpanded,
	onToggle,
}: {
	session: Session;
	isExpanded: boolean;
	onToggle: () => void;
}) {
	const badgeVariant = STATUS_BADGE_VARIANT[session.status];
	const statusLabel = STATUS_LABELS[session.status];
	const dotColor = STATUS_DOT[session.status];
	const projectName = session.projectPath.split("/").pop() ?? session.projectPath;

	return (
		<Card
			className={`overflow-hidden transition-all duration-200 ${
				isExpanded
					? "border-amber-200 shadow-md shadow-amber-500/5"
					: "hover:border-stone-300 hover:shadow-md hover:shadow-stone-200/50"
			}`}
		>
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-4 px-5 py-4 text-left"
				aria-expanded={isExpanded}
				aria-label={`Session ${session.id.slice(0, 8)}, ${statusLabel}, ${session.observationCount} observations`}
			>
				<div className="flex shrink-0 flex-col items-center gap-1">
					<div
						className={`h-2.5 w-2.5 rounded-full ${dotColor} ${session.status === "active" ? "animate-pulse" : ""}`}
						aria-hidden="true"
					/>
				</div>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2.5">
						<span className="font-mono text-sm font-semibold text-stone-800">
							{session.id.slice(0, 8)}
						</span>
						<Badge variant={badgeVariant} className="rounded-full text-[11px]">
							{statusLabel}
						</Badge>
						{session.observationCount > 0 && (
							<Badge variant="outline" className="rounded-full text-[11px]">
								{session.observationCount} obs
							</Badge>
						)}
					</div>
					<div className="mt-1 flex items-center gap-2 text-xs text-stone-400">
						<span className="font-medium text-stone-500">{projectName}</span>
						<span aria-hidden="true">&middot;</span>
						<span>{formatDate(session.startedAt)}</span>
						{session.endedAt && (
							<>
								<span aria-hidden="true">&rarr;</span>
								<span>{formatDate(session.endedAt)}</span>
							</>
						)}
					</div>
				</div>

				<svg
					className={`h-5 w-5 shrink-0 text-stone-300 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{isExpanded && (
				<div className="border-t border-stone-100">
					<ExpandedObservations sessionId={session.id} />
				</div>
			)}
		</Card>
	);
}
