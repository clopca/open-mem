import { useCallback, useState } from "react";
import { useAPI } from "../hooks/useAPI";
import type { Observation, ObservationType, Session } from "../types";

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

const statusConfig: Record<
	Session["status"],
	{ label: string; bg: string; text: string; dot: string }
> = {
	active: {
		label: "Active",
		bg: "bg-emerald-100",
		text: "text-emerald-700",
		dot: "bg-emerald-400",
	},
	idle: {
		label: "Idle",
		bg: "bg-amber-100",
		text: "text-amber-700",
		dot: "bg-amber-400",
	},
	completed: {
		label: "Completed",
		bg: "bg-stone-100",
		text: "text-stone-500",
		dot: "bg-stone-400",
	},
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
								<span
									key={`${observation.id}-${concept}`}
									className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
								>
									{concept}
								</span>
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
									<span
										key={`${observation.id}-mod-${f}`}
										className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700"
									>
										{f.split("/").pop()}
									</span>
								))}
								{observation.filesRead
									.filter((f) => !observation.filesModified.includes(f))
									.map((f) => (
										<span
											key={`${observation.id}-read-${f}`}
											className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] text-stone-500"
										>
											{f.split("/").pop()}
										</span>
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
	const { data: details, loading } = useAPI<SessionWithObservations>(`/api/sessions/${sessionId}`);
	const [expandedObsId, setExpandedObsId] = useState<string | null>(null);

	const toggleObs = useCallback((id: string) => {
		setExpandedObsId((prev) => (prev === id ? null : id));
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center py-8">
				<div className="flex items-center gap-3 text-sm text-stone-400">
					<svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
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
					Loading observations…
				</div>
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
	const status = statusConfig[session.status];
	const projectName = session.projectPath.split("/").pop() ?? session.projectPath;

	return (
		<div
			className={`overflow-hidden rounded-xl border transition-all duration-200 ${
				isExpanded
					? "border-amber-200 bg-white shadow-md shadow-amber-500/5"
					: "border-stone-200 bg-white shadow-sm hover:border-stone-300 hover:shadow-md hover:shadow-stone-200/50"
			}`}
		>
			<button
				type="button"
				onClick={onToggle}
				className="flex w-full items-center gap-4 px-5 py-4 text-left"
			>
				<div className="flex shrink-0 flex-col items-center gap-1">
					<div
						className={`h-2.5 w-2.5 rounded-full ${status.dot} ${session.status === "active" ? "animate-pulse" : ""}`}
					/>
				</div>

				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2.5">
						<span className="font-mono text-sm font-semibold text-stone-800">
							{session.id.slice(0, 8)}
						</span>
						<span
							className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.bg} ${status.text}`}
						>
							{status.label}
						</span>
						{session.observationCount > 0 && (
							<span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500">
								{session.observationCount} obs
							</span>
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
		</div>
	);
}
