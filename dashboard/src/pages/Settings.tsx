import { useAPI } from "../hooks/useAPI";

interface ConfigGroup {
	label: string;
	icon: string;
	keys: string[];
}

const CONFIG_GROUPS: ConfigGroup[] = [
	{ label: "Storage", icon: "\u{1F4BE}", keys: ["dbPath"] },
	{ label: "AI", icon: "\u{1F916}", keys: ["provider", "model", "maxTokensPerCompression"] },
	{
		label: "Behavior",
		icon: "\u2699\uFE0F",
		keys: [
			"compressionEnabled",
			"contextInjectionEnabled",
			"maxContextTokens",
			"batchSize",
			"batchIntervalMs",
		],
	},
	{ label: "Filtering", icon: "\u{1F50D}", keys: ["ignoredTools", "minOutputLength"] },
	{
		label: "Progressive Disclosure",
		icon: "\u{1F4D0}",
		keys: ["maxIndexEntries", "maxObservations", "contextFullObservationCount"],
	},
	{ label: "Privacy", icon: "\u{1F512}", keys: ["sensitivePatterns"] },
	{
		label: "Data Retention",
		icon: "\u{1F5D3}\uFE0F",
		keys: ["retentionDays", "maxDatabaseSizeMb"],
	},
	{ label: "Dashboard", icon: "\u{1F310}", keys: ["dashboardEnabled", "dashboardPort"] },
];

function camelToReadable(key: string): string {
	const uppercaseAbbreviations: Record<string, string> = {
		db: "DB",
		ai: "AI",
		ms: "ms",
		mb: "MB",
		api: "API",
		fts: "FTS",
		sse: "SSE",
	};

	const result = key
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (s) => s.toUpperCase())
		.trim();

	let formatted = result;
	for (const [abbr, replacement] of Object.entries(uppercaseAbbreviations)) {
		const regex = new RegExp(`\\b${abbr.charAt(0).toUpperCase() + abbr.slice(1)}\\b`, "g");
		formatted = formatted.replace(regex, replacement);
	}

	return formatted;
}

function formatValue(value: unknown): { display: string; type: "boolean" | "redacted" | "text" } {
	if (value === null || value === undefined) {
		return { display: "\u2014", type: "text" };
	}
	if (typeof value === "boolean") {
		return { display: value ? "\u2705" : "\u274C", type: "boolean" };
	}
	if (typeof value === "string" && value.includes("REDACTED")) {
		return { display: "***REDACTED***", type: "redacted" };
	}
	if (Array.isArray(value)) {
		return {
			display: value.length > 0 ? value.join(", ") : "\u2014 (empty)",
			type: "text",
		};
	}
	if (typeof value === "number") {
		return { display: value.toLocaleString("en-US"), type: "text" };
	}
	return { display: String(value), type: "text" };
}

export function Settings() {
	const { data, loading, error } = useAPI<Record<string, unknown>>("/api/config");

	const groupedKeys = new Set(CONFIG_GROUPS.flatMap((g) => g.keys));
	const otherKeys = data ? Object.keys(data).filter((k) => !groupedKeys.has(k)) : [];

	return (
		<div className="mx-auto max-w-4xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Settings</h1>
				<p className="mt-1 text-sm text-stone-500">Current configuration (read-only)</p>
			</div>

			{error && (
				<div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
					<p className="text-sm font-medium text-red-700">Failed to load configuration</p>
					<p className="mt-1 text-xs text-red-500">{error}</p>
				</div>
			)}

			{loading && <LoadingSkeleton />}

			{!loading && !error && data && (
				<div className="space-y-6">
					{CONFIG_GROUPS.map((group) => {
						const visibleKeys = group.keys.filter((k) => k in data);
						if (visibleKeys.length === 0) return null;

						return <SettingsGroup key={group.label} group={group} data={data} keys={visibleKeys} />;
					})}

					{otherKeys.length > 0 && (
						<SettingsGroup
							group={{ label: "Other", icon: "\u{1F4E6}", keys: otherKeys }}
							data={data}
							keys={otherKeys}
						/>
					)}
				</div>
			)}
		</div>
	);
}

function SettingsGroup({
	group,
	data,
	keys,
}: {
	group: ConfigGroup;
	data: Record<string, unknown>;
	keys: string[];
}) {
	return (
		<div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
			<div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50/50 px-5 py-3">
				<span className="text-base">{group.icon}</span>
				<h2 className="text-sm font-semibold text-stone-700">{group.label}</h2>
			</div>

			<div className="divide-y divide-stone-100">
				{keys.map((key) => {
					const { display, type } = formatValue(data[key]);

					return (
						<div key={key} className="flex items-center justify-between gap-4 px-5 py-3">
							<span className="text-sm font-medium text-stone-600">{camelToReadable(key)}</span>
							<span
								className={`text-right text-sm ${
									type === "redacted"
										? "font-mono text-xs text-stone-400"
										: type === "boolean"
											? "text-base"
											: "font-medium text-stone-800"
								}`}
							>
								{display}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function LoadingSkeleton() {
	return (
		<div className="space-y-6">
			{Array.from({ length: 4 }, (_, i) => (
				<div
					key={`group-skeleton-${i}`}
					className="animate-pulse overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm"
				>
					<div className="flex items-center gap-2.5 border-b border-stone-100 bg-stone-50/50 px-5 py-3">
						<div className="h-5 w-5 rounded bg-stone-100" />
						<div className="h-4 w-24 rounded bg-stone-100" />
					</div>
					{Array.from({ length: 3 }, (_, j) => (
						<div
							key={`row-skeleton-${i}-${j}`}
							className="flex items-center justify-between border-b border-stone-100 px-5 py-3 last:border-b-0"
						>
							<div className="h-4 w-32 rounded bg-stone-100" />
							<div className="h-4 w-20 rounded bg-stone-100" />
						</div>
					))}
				</div>
			))}
		</div>
	);
}
