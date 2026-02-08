import { useEffect, useMemo, useState } from "react";
import { Alert } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";

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
			if (!schemaRes.ok || !configRes.ok || !modesRes.ok)
				throw new Error("Failed to load settings");
			const schemaJson = unwrap(
				(await schemaRes.json()) as ConfigFieldSchema[] | Envelope<ConfigFieldSchema[]>,
			);
			const configJson = unwrap(
				(await configRes.json()) as ConfigResponse | Envelope<ConfigResponse>,
			);
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
	const warnings = preview?.warnings?.length ? preview.warnings : (effective?.warnings ?? []);

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
			const data = unwrap(
				(await res.json()) as Record<string, unknown> | Envelope<Record<string, unknown>>,
			);
			setMessage(
				`Folder context ${action}${dryRun ? " dry-run" : ""} complete: ${JSON.stringify(data)}`,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Maintenance failed");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<div>
					<Skeleton className="h-8 w-32" />
					<Skeleton className="mt-2 h-4 w-64" />
				</div>
				{Array.from({ length: 3 }, (_, i) => (
					<Card key={`settings-skeleton-${i}`}>
						<CardHeader className="bg-stone-50/70 px-5 py-3">
							<Skeleton className="h-4 w-24" />
						</CardHeader>
						<div className="space-y-3 p-5">
							<Skeleton className="h-8 w-full" />
							<Skeleton className="h-8 w-full" />
						</div>
					</Card>
				))}
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			<div>
				<h1 className="font-serif text-3xl text-stone-900 italic">Settings</h1>
				<p className="mt-1 text-sm text-stone-500">
					Editable project config with preview. Locked keys are overridden by environment variables.
				</p>
			</div>

			{error && (
				<Alert variant="destructive" aria-label="Error message">
					{error}
				</Alert>
			)}
			{message && (
				<Alert variant="success" aria-label="Success message">
					{message}
				</Alert>
			)}
			{warnings.length > 0 && (
				<Alert variant="warning" aria-label="Configuration warnings">
					<ul className="list-disc pl-5">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</Alert>
			)}

			<Card>
				<CardContent className="p-4">
					<div className="mb-2 text-sm font-semibold text-stone-700">Modes</div>
					<div className="flex flex-wrap gap-2">
						{modes.map((mode) => (
							<Button
								key={mode.id}
								variant="outline"
								onClick={() => applyMode(mode.id)}
								disabled={saving}
								aria-label={`Apply ${mode.id} mode`}
							>
								Apply {mode.id}
							</Button>
						))}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="p-4">
					<div className="mb-2 text-sm font-semibold text-stone-700">
						Folder Context Maintenance
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							onClick={() => runFolderContextMaintenance("clean", true)}
							disabled={saving}
							aria-label="Clean folder context dry run"
						>
							Clean Dry-run
						</Button>
						<Button
							variant="outline"
							onClick={() => runFolderContextMaintenance("clean", false)}
							disabled={saving}
							aria-label="Clean folder context"
						>
							Clean
						</Button>
						<Button
							variant="outline"
							onClick={() => runFolderContextMaintenance("rebuild", true)}
							disabled={saving}
							aria-label="Rebuild folder context dry run"
						>
							Rebuild Dry-run
						</Button>
						<Button
							variant="outline"
							onClick={() => runFolderContextMaintenance("rebuild", false)}
							disabled={saving}
							aria-label="Rebuild folder context"
						>
							Rebuild
						</Button>
					</div>
				</CardContent>
			</Card>

			{GROUP_ORDER.map((group) => {
				const fields = grouped.get(group) ?? [];
				if (fields.length === 0) return null;
				return (
					<Card key={group} className="overflow-hidden">
						<CardHeader className="bg-stone-50/70 px-5 py-3">
							<span className="text-sm font-semibold text-stone-700">{group}</span>
						</CardHeader>
						<div className="divide-y divide-stone-100">
							{fields.map((field) => {
								const meta = effective?.meta?.[field.key];
								const locked = Boolean(meta?.locked);
								const value = field.key in draft ? draft[field.key] : visibleConfig[field.key];
								return (
									<div
										key={field.key}
										className="grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[240px_1fr] md:items-center"
									>
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
														aria-label={field.label}
													/>
													<span>{value ? "Enabled" : "Disabled"}</span>
												</label>
											)}
											{field.type === "number" && (
												<Input
													type="number"
													value={typeof value === "number" ? value : Number(value ?? 0)}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													min={field.min}
													max={field.max}
													aria-label={field.label}
												/>
											)}
											{field.type === "string" && field.enum && (
												<Select
													value={String(value ?? "")}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													aria-label={field.label}
												>
													{field.enum.map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</Select>
											)}
											{field.type === "string" && !field.enum && (
												<Input
													type="text"
													value={String(value ?? "")}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													aria-label={field.label}
												/>
											)}
											{field.type === "array" && (
												<Input
													type="text"
													value={toArrayString(value)}
													onChange={(e) => onValueChange(field, e.target.value)}
													disabled={locked || saving}
													placeholder="comma, separated, values"
													aria-label={field.label}
												/>
											)}
										</div>
									</div>
								);
							})}
						</div>
					</Card>
				);
			})}

			<Card className="sticky bottom-4 bg-white/90 backdrop-blur">
				<div className="flex flex-wrap gap-2 p-3">
					<Button
						variant="outline"
						onClick={previewDraft}
						disabled={saving || Object.keys(draft).length === 0}
						aria-label="Preview configuration changes"
					>
						Preview
					</Button>
					<Button
						onClick={saveDraft}
						disabled={saving || Object.keys(draft).length === 0}
						aria-label="Save configuration"
					>
						Save
					</Button>
					<Button
						variant="outline"
						onClick={() => {
							setDraft({});
							setPreview(null);
							setMessage("Draft reset.");
						}}
						disabled={saving || Object.keys(draft).length === 0}
						aria-label="Reset draft changes"
					>
						Reset draft
					</Button>
				</div>
			</Card>
		</div>
	);
}
