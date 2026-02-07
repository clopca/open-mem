import { useState } from "react";
import type { ObservationType, SearchResult as SearchResultType } from "../types";

const typeConfig: Record<ObservationType, { icon: string; label: string; color: string }> = {
	bugfix: { icon: "\u{1F41B}", label: "Bugfix", color: "bg-red-50 text-red-700 ring-red-200" },
	discovery: {
		icon: "\u{1F4A1}",
		label: "Discovery",
		color: "bg-amber-50 text-amber-700 ring-amber-200",
	},
	refactor: {
		icon: "\u{1F527}",
		label: "Refactor",
		color: "bg-sky-50 text-sky-700 ring-sky-200",
	},
	decision: {
		icon: "\u{1F3AF}",
		label: "Decision",
		color: "bg-violet-50 text-violet-700 ring-violet-200",
	},
	feature: {
		icon: "\u2728",
		label: "Feature",
		color: "bg-emerald-50 text-emerald-700 ring-emerald-200",
	},
	change: {
		icon: "\u{1F4DD}",
		label: "Change",
		color: "bg-stone-100 text-stone-600 ring-stone-200",
	},
};

function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays < 7) return `${diffDays}d ago`;
	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function RelevanceBar({ rank }: { rank: number }) {
	const percentage = Math.min(Math.max(rank * 100, 5), 100);
	return (
		<div className="flex items-center gap-2">
			<div className="h-1 w-16 overflow-hidden rounded-full bg-stone-100">
				<div
					className="h-full rounded-full bg-amber-400 transition-all duration-500"
					style={{ width: `${percentage}%` }}
				/>
			</div>
			<span className="text-[10px] tabular-nums text-stone-400">{rank.toFixed(2)}</span>
		</div>
	);
}

interface SearchResultCardProps {
	result: SearchResultType;
}

export function SearchResultCard({ result }: SearchResultCardProps) {
	const [expanded, setExpanded] = useState(false);
	const { observation, rank, snippet } = result;
	const config = typeConfig[observation.type];

	const allFiles = [...new Set([...observation.filesRead, ...observation.filesModified])];

	return (
		<button
			type="button"
			onClick={() => setExpanded((prev) => !prev)}
			className="group w-full cursor-pointer text-left rounded-xl bg-white shadow-sm ring-1 ring-stone-200/60 transition-all duration-200 hover:shadow-md hover:ring-stone-300/80"
		>
			<div className="px-5 py-4">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-start gap-3 min-w-0">
						<span
							className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ring-1 ${config.color}`}
						>
							{config.icon}
						</span>
						<div className="min-w-0">
							<h3 className="text-sm font-semibold leading-snug text-stone-800 group-hover:text-stone-950">
								{observation.title}
							</h3>
							<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
								<span
									className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${config.color}`}
								>
									{config.label}
								</span>
								<span className="text-[11px] text-stone-400">
									{formatDate(observation.createdAt)}
								</span>
								<RelevanceBar rank={rank} />
							</div>
						</div>
					</div>

					<svg
						className={`mt-1 h-4 w-4 shrink-0 text-stone-300 transition-transform duration-200 group-hover:text-stone-500 ${
							expanded ? "rotate-180" : ""
						}`}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</div>

				<p className="mt-2.5 text-[13px] leading-relaxed text-stone-500 line-clamp-2">{snippet}</p>
			</div>

			{expanded && (
				<div className="border-t border-stone-100 px-5 py-4 space-y-4">
					{observation.narrative && (
						<div>
							<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
								Narrative
							</h4>
							<p className="text-[13px] leading-relaxed text-stone-600">{observation.narrative}</p>
						</div>
					)}

					{observation.facts.length > 0 && (
						<div>
							<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
								Key Facts
							</h4>
							<ul className="space-y-1">
								{observation.facts.map((fact) => (
									<li key={fact} className="flex items-start gap-2 text-[13px] text-stone-600">
										<span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
										{fact}
									</li>
								))}
							</ul>
						</div>
					)}

					{observation.concepts.length > 0 && (
						<div>
							<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
								Concepts
							</h4>
							<div className="flex flex-wrap gap-1.5">
								{observation.concepts.map((concept) => (
									<span
										key={concept}
										className="inline-flex rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500"
									>
										{concept}
									</span>
								))}
							</div>
						</div>
					)}

					{allFiles.length > 0 && (
						<div>
							<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
								Files
							</h4>
							<div className="flex flex-wrap gap-1.5">
								{allFiles.map((file) => (
									<span
										key={file}
										className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-mono text-amber-700"
									>
										<svg
											className="h-3 w-3"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
											aria-hidden="true"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
											/>
										</svg>
										{file}
									</span>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</button>
	);
}
