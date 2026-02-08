import { useEffect, useMemo, useState } from "react";

type FieldType = "string" | "number" | "boolean" | "array";
type Group =
	| "Storage"
	| "AI"
	| "Behavior"
	| "Filtering"
	| "Progressive Disclosure"
	| "Privacy"
	| "Data Retention"
	| "Dashboard"
	| "Advanced";

interface ConfigFieldSchema {
	key: string;
	label: string;
	type: FieldType;
	group: Group;
	liveApply: boolean;
	restartRequired: boolean;
	secret?: boolean;
	min?: number;
	max?: number;
	enum?: string[];
	description?: string;
}

interface ConfigMeta {
	source: "default" | "file" | "env";
	locked: boolean;
	restartRequired: boolean;
	liveApply: boolean;
}

interface ConfigResponse {
	config: Record<string, unknown>;
	meta: Record<string, ConfigMeta>;
	warnings: string[];
}

interface ModesResponse {
	modes: Array<{ id: string; patch: Record<string, unknown> }>;
}

interface Envelope<T> {
	data: T;
	error: { code: string; message: string } | null;
	meta: Record<string, unknown>;
}

function unwrap<T>(value: T | Envelope<T>): T {
	if (value && typeof value === "object" && "data" in (value as Record<string, unknown>)) {
		return (value as Envelope<T>).data;
	}
	return value as T;
}

const GROUP_ORDER: Group[] = [
	"Storage",
	"AI",
	"Behavior",
	"Filtering",
	"Progressive Disclosure",
	"Privacy",
	"Data Retention",
	"Dashboard",
	"Advanced",
];

function toArrayString(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value.join(", ");
}

function fromArrayString(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

export function Settings() {
	const [schema, setSchema] = useState<ConfigFieldSchema[]>([]);
	const [effective, setEffective] = useState<ConfigResponse | null>(null);
	const [preview, setPreview] = useState<ConfigResponse | null>(null);
	const [modes, setModes] = useState<Array<{ id: string; patch: Record<string, unknown> }>>([]);
	const [draft, setDraft] = useState<Record<string, unknown>>({});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const [schemaRes, configRes, modesRes] = await Promise.all([
				fetch("/v1/config/schema"),
				fetch("/v1/config/effective"),
				fetch("/v1/modes"),
			]);
			if (!schemaRes.ok || !configRes.ok || !modesRes.ok) throw new Error("Failed to load settings");
			const schemaJson = unwrap((await schemaRes.json()) as ConfigFieldSchema[] | Envelope<ConfigFieldSchema[]>);
			const configJson = unwrap((await configRes.json()) as ConfigResponse | Envelope<ConfigResponse>);
			const modesJson = unwrap((await modesRes.json()) as ModesResponse | Envelope<ModesResponse>);
			setSchema(schemaJson);
			setEffective(configJson);
			setModes(modesJson.modes ?? []);
			setPreview(null);
			setDraft({});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		load();
	}, []);

	const grouped = useMemo(() => {
		const map = new Map<Group, ConfigFieldSchema[]>();
		for (const group of GROUP_ORDER) map.set(group, []);
		for (const field of schema) {
			const list = map.get(field.group) ?? [];
			list.push(field);
			map.set(field.group, list);
		}
		return map;
	}, [schema]);

	const baseConfig = effective?.config ?? {};
	const visibleConfig = preview?.config ?? baseConfig;
	const warnings = preview?.warnings?.length ? preview.warnings : effective?.warnings ?? [];

	function onValueChange(field: ConfigFieldSchema, raw: string | boolean) {
		setMessage(null);
		setPreview(null);
		setDraft((prev) => {
			const next = { ...prev };
			if (field.type === "boolean") next[field.key] = raw;
			if (field.type === "number") next[field.key] = Number(raw);
			if (field.type === "string") next[field.key] = String(raw);
			if (field.type === "array") next[field.key] = fromArrayString(String(raw));
			return next;
		});
	}

	async function previewDraft() {
		setSaving(true);
		setError(null);
		setMessage(null);
		try {
			const res = await fetch("/v1/config/preview", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(draft),
			});
			if (!res.ok) throw new Error(await res.text());
			const json = unwrap((await res.json()) as ConfigResponse | Envelope<ConfigResponse>);
			setPreview(json);
			setMessage("Preview updated.");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Preview failed");
		} finally {
			setSaving(false);
		}
	}

	async function saveDraft() {
		setSaving(true);
		setError(null);
		setMessage(null);
		try {
			const res = await fetch("/v1/config", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(draft),
			});
			if (!res.ok) throw new Error(await res.text());
			const json = unwrap((await res.json()) as ConfigResponse | Envelope<ConfigResponse>);
			setEffective(json);
			setPreview(null);
			setDraft({});
			setMessage("Configuration saved to .open-mem/config.json");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Save failed");
		} finally {
			setSaving(false);
		}
	}

	async function applyMode(id: string) {
		setSaving(true);
		setError(null);
		try {
			const res = await fetch(`/v1/modes/${id}/apply`, { method: "POST" });
			if (!res.ok) throw new Error(await res.text());
			await load();
			setMessage(`Mode ${id} applied.`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Mode apply failed");
		} finally {
			setSaving(false);
		}
	}

	async function runFolderContextMaintenance(action: "clean" | "rebuild", dryRun: boolean) {
		setSaving(true);
		setError(null);
		try {
			const endpoint = dryRun
				? "/v1/maintenance/folder-context/dry-run"
				: `/v1/maintenance/folder-context/${action}`;
			const res = await fetch(endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(dryRun ? { action } : {}),
			});
			if (!res.ok) throw new Error(await res.text());
			const data = unwrap((await res.json()) as Record<string, unknown> | Envelope<Record<string, unknown>>);
			setMessage(`Folder context ${action}${dryRun ? " dry-run" : ""} complete: ${JSON.stringify(data)}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Maintenance failed");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <div className="text-sm text-stone-500">Loading settings...</div>;
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<div>
				<h1 className="font-serif text-3xl text-stone-900 italic">Settings</h1>
				<p className="mt-1 text-sm text-stone-500">
					Editable project config with preview. Locked keys are overridden by environment variables.
				</p>
			</div>

			{error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
			{message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
			{warnings.length > 0 && (
				<div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
					<ul className="list-disc pl-5">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</div>
			)}

			<div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
				<div className="mb-2 text-sm font-semibold text-stone-700">Modes</div>
				<div className="flex flex-wrap gap-2">
					{modes.map((mode) => (
						<button
							key={mode.id}
							type="button"
							onClick={() => applyMode(mode.id)}
							disabled={saving}
							className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
						>
							Apply {mode.id}
						</button>
					))}
				</div>
			</div>

			<div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
				<div className="mb-2 text-sm font-semibold text-stone-700">Folder Context Maintenance</div>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => runFolderContextMaintenance("clean", true)}
						disabled={saving}
						className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
					>
						Clean Dry-run
					</button>
					<button
						type="button"
						onClick={() => runFolderContextMaintenance("clean", false)}
						disabled={saving}
						className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
					>
						Clean
					</button>
					<button
						type="button"
						onClick={() => runFolderContextMaintenance("rebuild", true)}
						disabled={saving}
						className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
					>
						Rebuild Dry-run
					</button>
					<button
						type="button"
						onClick={() => runFolderContextMaintenance("rebuild", false)}
						disabled={saving}
						className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
					>
						Rebuild
					</button>
				</div>
			</div>

			{GROUP_ORDER.map((group) => {
				const fields = grouped.get(group) ?? [];
				if (fields.length === 0) return null;
				return (
					<div key={group} className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
						<div className="border-b border-stone-100 bg-stone-50/70 px-5 py-3 text-sm font-semibold text-stone-700">{group}</div>
						<div className="divide-y divide-stone-100">
							{fields.map((field) => {
								const meta = effective?.meta?.[field.key];
								const locked = Boolean(meta?.locked);
								const value = field.key in draft ? draft[field.key] : visibleConfig[field.key];
								return (
									<div key={field.key} className="grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[240px_1fr] md:items-center">
										<div>
											<div className="text-sm font-medium text-stone-700">{field.label}</div>
											<div className="text-xs text-stone-500">
												{field.key} · {meta?.source ?? "default"}
												{field.restartRequired ? " · restart required" : " · live apply"}
												{locked ? " · locked by env" : ""}
											</div>
										</div>
										<div>
											{field.type === "boolean" && (
												<label className="inline-flex items-center gap-2 text-sm text-stone-700">
													<input
														type="checkbox"
														checked={Boolean(value)}
														onChange={(e) => onValueChange(field, e.target.checked)}
														disabled={locked || saving}
													/>
													<span>{Boolean(value) ? "Enabled" : "Disabled"}</span>
												</label>
											)}
											{field.type === "number" && (
												<input
													type="number"
													value={typeof value === "number" ? value : Number(value ?? 0)}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
													min={field.min}
													max={field.max}
												/>
											)}
											{field.type === "string" && field.enum && (
												<select
													value={String(value ?? "")}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
												>
													{field.enum.map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</select>
											)}
											{field.type === "string" && !field.enum && (
												<input
													type="text"
													value={String(value ?? "")}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
												/>
											)}
											{field.type === "array" && (
												<input
													type="text"
													value={toArrayString(value)}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
													placeholder="comma, separated, values"
												/>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</div>
				);
			})}

			<div className="sticky bottom-4 flex flex-wrap gap-2 rounded-xl border border-stone-200 bg-white/90 p-3 shadow-sm backdrop-blur">
				<button
					type="button"
					onClick={previewDraft}
					disabled={saving || Object.keys(draft).length === 0}
					className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
				>
					Preview
				</button>
				<button
					type="button"
					onClick={saveDraft}
					disabled={saving || Object.keys(draft).length === 0}
					className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white hover:bg-stone-800 disabled:opacity-60"
				>
					Save
				</button>
				<button
					type="button"
					onClick={() => {
						setDraft({});
						setPreview(null);
						setMessage("Draft reset.");
					}}
					disabled={saving || Object.keys(draft).length === 0}
					className="rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-60"
				>
					Reset draft
				</button>
			</div>
		</div>
	);
}
