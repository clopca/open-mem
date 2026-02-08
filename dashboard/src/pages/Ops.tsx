import { useAPI } from "../hooks/useAPI";
import type { HealthResponse, MetricsResponse, PlatformsResponse } from "../types";
import type { ReactNode } from "react";

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function Ops() {
  const health = useAPI<HealthResponse>("/v1/health");
  const metrics = useAPI<MetricsResponse>("/v1/metrics");
  const platforms = useAPI<PlatformsResponse>("/v1/platforms");

  const loading = health.loading || metrics.loading || platforms.loading;
  const error = health.error || metrics.error || platforms.error;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <h1 className="font-serif text-3xl text-stone-900 italic">Operations</h1>
        <p className="mt-1 text-sm text-stone-500">Runtime health, queue status, and ingestion diagnostics</p>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <p className="text-sm font-medium text-red-700">Failed to load operational data</p>
          <p className="mt-1 text-xs text-red-500">{error}</p>
        </div>
      )}

      {loading && (
        <div className="rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-500">Loading runtime status...</div>
      )}

      {!loading && !error && health.data && metrics.data && platforms.data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Service Status" value={health.data.status.toUpperCase()} subtitle={new Date(health.data.timestamp).toLocaleString()} />
            <MetricCard title="Queue Pending" value={String(health.data.queue.pending)} subtitle={`Mode: ${health.data.queue.mode}`} />
            <MetricCard title="Batch Avg" value={formatMs(metrics.data.batches.avgDurationMs)} subtitle={`${metrics.data.batches.total} total batches`} />
            <MetricCard title="Enqueued" value={String(metrics.data.enqueueCount)} subtitle={`Uptime: ${formatMs(metrics.data.uptimeMs)}`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel title="Queue State">
              <Row label="Running" value={String(health.data.queue.running)} />
              <Row label="Processing" value={String(health.data.queue.processing)} />
              <Row label="Last Batch Duration" value={formatMs(health.data.queue.lastBatchDurationMs)} />
              <Row label="Last Processed" value={health.data.queue.lastProcessedAt ?? "never"} />
              <Row label="Last Failure" value={health.data.queue.lastFailedAt ?? "none"} />
            </Panel>

            <Panel title="Batch Throughput">
              <Row label="Processed Items" value={String(metrics.data.batches.processedItems)} />
              <Row label="Failed Items" value={String(metrics.data.batches.failedItems)} />
              <Row label="Total Observations" value={String(health.data.memory.totalObservations)} />
              <Row label="Total Sessions" value={String(health.data.memory.totalSessions)} />
              <Row label="Last Error" value={health.data.queue.lastError ?? "none"} />
            </Panel>

            <Panel title="Platform Adapters">
              {platforms.data.platforms.map((platform) => (
                <div key={platform.name} className="border-b border-stone-100 px-4 py-3 last:border-b-0">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="font-medium text-stone-800">{platform.name}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        platform.enabled ? "bg-emerald-100 text-emerald-700" : "bg-stone-200 text-stone-600"
                      }`}
                    >
                      {platform.enabled ? "enabled" : "disabled"}
                    </span>
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
        </>
      )}
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium tracking-wide text-stone-400 uppercase">{title}</p>
      <p className="mt-2 font-serif text-2xl text-stone-900 italic">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-stone-500">{subtitle}</p>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-100 px-4 py-3">
        <h2 className="font-serif text-lg text-stone-800 italic">{title}</h2>
      </div>
      <div className="divide-y divide-stone-100">{children}</div>
    </div>
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
