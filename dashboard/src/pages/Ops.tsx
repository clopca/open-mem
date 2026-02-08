import type { ReactNode } from "react";
import { Alert } from "../components/ui/alert";
import { Badge } from "../components/ui/badge";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { useAPI } from "../hooks/useAPI";
import type { AdapterStatus, HealthResponse, MetricsResponse, PlatformsResponse } from "../types";

function formatMs(ms: number): string {
	if (ms < 1000) return `${ms} ms`;
	return `${(ms / 1000).toFixed(1)} s`;
}

export function Ops() {
	const health = useAPI<HealthResponse>("/v1/health");
	const metrics = useAPI<MetricsResponse>("/v1/metrics");
	const platforms = useAPI<PlatformsResponse>("/v1/platforms");
	const adapters = useAPI<AdapterStatus[]>("/v1/adapters/status");

	const loading = health.loading || metrics.loading || platforms.loading;
	const error = health.error || metrics.error || platforms.error || adapters.error;

	return (
		<div className="mx-auto max-w-5xl">
			<div className="mb-8">
				<h1 className="font-serif text-3xl text-stone-900 italic">Operations</h1>
				<p className="mt-1 text-sm text-stone-500">
					Runtime health, queue status, and ingestion diagnostics
				</p>
			</div>

			{error && (
				<Alert variant="destructive" className="mb-6">
					<p className="font-medium">Failed to load operational data</p>
					<p className="mt-1 text-xs opacity-80">{error}</p>
				</Alert>
			)}

			{loading && (
				<div className="space-y-4">
					<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
						{Array.from({ length: 4 }, (_, i) => (
							<Card key={`ops-skeleton-${i}`}>
								<CardContent className="p-4">
									<Skeleton className="mb-2 h-3 w-20" />
									<Skeleton className="h-7 w-16" />
									<Skeleton className="mt-1 h-3 w-28" />
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{!loading && !error && health.data && metrics.data && platforms.data && (
				<>
					<div
						className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
						role="status"
						aria-label="Service health metrics"
					>
						<MetricCard
							title="Service Status"
							value={health.data.status.toUpperCase()}
							subtitle={new Date(health.data.timestamp).toLocaleString()}
						/>
						<MetricCard
							title="Queue Pending"
							value={String(health.data.queue.pending)}
							subtitle={`Mode: ${health.data.queue.mode}`}
						/>
						<MetricCard
							title="Batch Avg"
							value={formatMs(metrics.data.batches.avgDurationMs)}
							subtitle={`${metrics.data.batches.total} total batches`}
						/>
						<MetricCard
							title="Enqueued"
							value={String(metrics.data.enqueueCount)}
							subtitle={`Uptime: ${formatMs(metrics.data.uptimeMs)}`}
						/>
					</div>

					<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
						<Panel title="Queue State" ariaLabel="Queue state details">
							<Row label="Running" value={String(health.data.queue.running)} />
							<Row label="Processing" value={String(health.data.queue.processing)} />
							<Row
								label="Last Batch Duration"
								value={formatMs(health.data.queue.lastBatchDurationMs)}
							/>
							<Row label="Last Processed" value={health.data.queue.lastProcessedAt ?? "never"} />
							<Row label="Last Failure" value={health.data.queue.lastFailedAt ?? "none"} />
						</Panel>

						<Panel title="Batch Throughput" ariaLabel="Batch throughput details">
							<Row label="Processed Items" value={String(metrics.data.batches.processedItems)} />
							<Row label="Failed Items" value={String(metrics.data.batches.failedItems)} />
							<Row
								label="Total Observations"
								value={String(health.data.memory.totalObservations)}
							/>
							<Row label="Total Sessions" value={String(health.data.memory.totalSessions)} />
							<Row label="Last Error" value={health.data.queue.lastError ?? "none"} />
						</Panel>

						<Panel title="Platform Adapters" ariaLabel="Platform adapter status">
							{platforms.data.platforms.map((platform) => (
								<div
									key={platform.name}
									className="border-b border-stone-100 px-4 py-3 last:border-b-0"
								>
									<div className="mb-2 flex items-center justify-between gap-3">
										<span className="font-medium text-stone-800">{platform.name}</span>
										<Badge variant={platform.enabled ? "success" : "muted"}>
											{platform.enabled ? "enabled" : "disabled"}
										</Badge>
									</div>
									<div className="space-y-1 text-xs text-stone-500">
										<p>Version: {platform.version}</p>
										<p>Session lifecycle: {String(platform.capabilities.nativeSessionLifecycle)}</p>
										<p>Tool capture: {String(platform.capabilities.nativeToolCapture)}</p>
										<p>Chat capture: {String(platform.capabilities.nativeChatCapture)}</p>
										<p>Idle flush emulated: {String(platform.capabilities.emulatedIdleFlush)}</p>
									</div>
								</div>
							))}
						</Panel>
					</div>

					{adapters.error && !adapters.data && (
						<div className="mt-6">
							<Alert variant="warning">
								<p className="font-medium">Adapter status unavailable</p>
								<p className="mt-1 text-xs opacity-80">{adapters.error}</p>
							</Alert>
						</div>
					)}

					{adapters.data && adapters.data.length > 0 && (
						<div className="mt-6">
							<Panel title="Adapter Status" ariaLabel="Adapter connection status">
								{adapters.data.map((adapter) => (
									<div
										key={adapter.name}
										className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
									>
										<div className="flex items-center gap-2">
											<span className="font-medium text-stone-800">{adapter.name}</span>
											<Badge variant={adapter.enabled ? "success" : "muted"}>
												{adapter.enabled ? "enabled" : "disabled"}
											</Badge>
											{adapter.connected && <Badge variant="success">connected</Badge>}
										</div>
										<div className="flex items-center gap-3 text-xs text-stone-500">
											<span>{adapter.eventsIngested ?? 0} events</span>
											{(adapter.errors ?? 0) > 0 && (
												<Badge variant="danger">{adapter.errors} errors</Badge>
											)}
										</div>
									</div>
								))}
							</Panel>
						</div>
					)}
				</>
			)}
		</div>
	);
}

function MetricCard({
	title,
	value,
	subtitle,
}: {
	title: string;
	value: string;
	subtitle?: string;
}) {
	return (
		<Card>
			<CardContent className="p-4">
				<p className="text-xs font-medium tracking-wide text-stone-400 uppercase">{title}</p>
				<p className="mt-2 font-serif text-2xl text-stone-900 italic">{value}</p>
				{subtitle && <p className="mt-1 text-xs text-stone-500">{subtitle}</p>}
			</CardContent>
		</Card>
	);
}

function Panel({
	title,
	children,
	ariaLabel,
}: {
	title: string;
	children: ReactNode;
	ariaLabel?: string;
}) {
	return (
		<Card aria-label={ariaLabel}>
			<CardHeader className="px-4 py-3">
				<h2 className="font-serif text-lg text-stone-800 italic">{title}</h2>
			</CardHeader>
			<div className="divide-y divide-stone-100">{children}</div>
		</Card>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
			<span className="text-stone-500">{label}</span>
			<span className="font-medium text-stone-800">{value}</span>
		</div>
	);
}
