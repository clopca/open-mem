import type { ObservationType, SearchResult as SearchResultType } from "../types";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

const typeConfig: Record<
	ObservationType,
	{
		icon: string;
		label: string;
		variant: "danger" | "warning" | "outline" | "success" | "muted" | "default";
	}
> = {
	bugfix: { icon: "\u{1F41B}", label: "Bugfix", variant: "danger" },
	discovery: { icon: "\u{1F4A1}", label: "Discovery", variant: "warning" },
	refactor: { icon: "\u{1F527}", label: "Refactor", variant: "outline" },
	decision: { icon: "\u{1F3AF}", label: "Decision", variant: "default" },
	feature: { icon: "\u2728", label: "Feature", variant: "success" },
	change: { icon: "\u{1F4DD}", label: "Change", variant: "muted" },
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
			<div
				className="h-1 w-16 overflow-hidden rounded-full bg-stone-100"
				role="progressbar"
				aria-valuenow={Math.round(percentage)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label={`Relevance: ${rank.toFixed(2)}`}
			>
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
	const { observation, rank, snippet, explain } = result;
	const config = typeConfig[observation.type];

	const allFiles = [...new Set([...observation.filesRead, ...observation.filesModified])];

	return (
		<Card className="group transition-all duration-200 hover:shadow-md">
			<Accordion type="single" collapsible>
				<AccordionItem value="details" className="border-b-0">
					<div className="px-5 py-4">
						<div className="flex items-start justify-between gap-3">
							<div className="flex items-start gap-3 min-w-0">
								<Badge variant={config.variant} className="mt-0.5 shrink-0" aria-hidden="true">
									{config.icon}
								</Badge>
								<div className="min-w-0">
									<h3 className="text-sm font-semibold leading-snug text-stone-800 group-hover:text-stone-950">
										{observation.title}
									</h3>
									<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
										<Badge variant={config.variant} className="text-[10px]">
											{config.label}
										</Badge>
										<span className="text-[11px] text-stone-400">
											{formatDate(observation.createdAt)}
										</span>
										<RelevanceBar rank={rank} />
										{explain?.strategy && (
											<Badge variant="muted" className="text-[10px]">
												{explain.strategy}
											</Badge>
										)}
									</div>
								</div>
							</div>

							<AccordionTrigger
								className="mt-1 shrink-0 p-0"
								aria-label={`Expand details for ${observation.title}`}
							/>
						</div>

						<p className="mt-2.5 text-[13px] leading-relaxed text-stone-500 line-clamp-2">
							{snippet}
						</p>
					</div>

					<AccordionContent className="px-5 pb-4 space-y-4">
						{explain && (
							<div>
								<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
									Why this result
								</h4>
								<div className="flex flex-wrap items-center gap-1.5">
									{explain.matchedBy.map((signal) => (
										<Badge
											key={`${observation.id}-${signal}`}
											variant="outline"
											className="bg-sky-50 text-sky-700"
										>
											{signal}
										</Badge>
									))}
									{typeof explain.rrfScore === "number" && (
										<Badge variant="muted" className="text-[10px]">
											RRF {explain.rrfScore.toFixed(4)}
										</Badge>
									)}
									{typeof explain.ftsRank === "number" && (
										<Badge variant="muted" className="text-[10px]">
											FTS {explain.ftsRank.toFixed(3)}
										</Badge>
									)}
									{typeof explain.vectorSimilarity === "number" && (
										<Badge variant="muted" className="text-[10px]">
											Vec sim {explain.vectorSimilarity.toFixed(3)}
										</Badge>
									)}
									{typeof explain.vectorDistance === "number" && (
										<Badge variant="muted" className="text-[10px]">
											Vec dist {explain.vectorDistance.toFixed(3)}
										</Badge>
									)}
								</div>
							</div>
						)}

						{observation.narrative && (
							<div>
								<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
									Narrative
								</h4>
								<p className="text-[13px] leading-relaxed text-stone-600">
									{observation.narrative}
								</p>
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
							<div>
								<h4 className="mb-1.5 text-[10px] font-semibold tracking-wider text-stone-400 uppercase">
									Concepts
								</h4>
								<div className="flex flex-wrap gap-1.5">
									{observation.concepts.map((concept) => (
										<Badge key={concept} variant="warning" className="rounded-full text-[11px]">
											{concept}
										</Badge>
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
										<Badge key={file} variant="warning" className="gap-1 font-mono text-[11px]">
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
										</Badge>
									))}
								</div>
							</div>
						)}
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</Card>
	);
}
