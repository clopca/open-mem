// =============================================================================
// open-mem — Hono HTTP Server for Web Dashboard
// =============================================================================

import { normalize, resolve, sep } from "node:path";
import type { EmbeddingModel } from "ai";
import type { Context } from "hono";
import { Hono } from "hono";
import type { ObservationRepository } from "../db/observations";
import type { SessionRepository } from "../db/sessions";
import type { SummaryRepository } from "../db/summaries";
import { hybridSearch } from "../search/hybrid";
import type { ObservationType, OpenMemConfig } from "../types";

// -----------------------------------------------------------------------------
// Dependency Injection
// -----------------------------------------------------------------------------

export interface DashboardDeps {
	observationRepo: ObservationRepository;
	sessionRepo: SessionRepository;
	summaryRepo: SummaryRepository;
	config: OpenMemConfig;
	projectPath: string;
	embeddingModel: EmbeddingModel | null;
	/** Optional SSE handler — registered before the catch-all `*` route */
	sseHandler?: (c: Context) => Response | Promise<Response>;
}

// -----------------------------------------------------------------------------
// Valid Observation Types
// -----------------------------------------------------------------------------

const VALID_OBSERVATION_TYPES: Set<string> = new Set([
	"decision",
	"bugfix",
	"feature",
	"refactor",
	"discovery",
	"change",
]);

// -----------------------------------------------------------------------------
// Input Validation Helpers
// -----------------------------------------------------------------------------

function clampLimit(value: string | undefined, defaultVal: number, max = 100): number {
	if (!value) return defaultVal;
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n)) return defaultVal;
	return Math.max(1, Math.min(n, max));
}

function clampOffset(value: string | undefined): number {
	if (!value) return 0;
	const n = Number.parseInt(value, 10);
	if (Number.isNaN(n)) return 0;
	return Math.max(0, n);
}

function validateType(value: string | undefined): ObservationType | undefined {
	if (!value) return undefined;
	if (VALID_OBSERVATION_TYPES.has(value)) return value as ObservationType;
	return undefined;
}

// -----------------------------------------------------------------------------
// Config Redaction
// -----------------------------------------------------------------------------

function redactConfig(config: OpenMemConfig): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(config)) {
		const lowerKey = key.toLowerCase();
		if (typeof value === "string" && (lowerKey.includes("key") || lowerKey.includes("api"))) {
			result[key] = "***REDACTED***";
		} else {
			result[key] = value;
		}
	}
	return result;
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------

/**
 * Create a Hono app for the dashboard REST API.
 * Does NOT start an HTTP server — returns the app for the caller to serve.
 */
export function createDashboardApp(deps: DashboardDeps): Hono {
	const { observationRepo, sessionRepo, summaryRepo, config, projectPath, embeddingModel } = deps;

	const app = new Hono();

	// -------------------------------------------------------------------------
	// GET /api/observations — List observations
	// -------------------------------------------------------------------------

	app.get("/api/observations", (c) => {
		const limit = clampLimit(c.req.query("limit"), 50);
		const offset = clampOffset(c.req.query("offset"));
		const type = validateType(c.req.query("type"));
		const sessionId = c.req.query("sessionId");

		if (sessionId) {
			let observations = observationRepo.getBySession(sessionId);
			if (type) {
				observations = observations.filter((o) => o.type === type);
			}
			const paged = observations.slice(offset, offset + limit);
			return c.json(paged);
		}

		const index = observationRepo.getIndex(projectPath, offset + limit);
		let items = index.slice(offset);

		if (type) {
			items = items.filter((o) => o.type === type);
		}

		const observations = items
			.map((item) => observationRepo.getById(item.id))
			.filter((o): o is NonNullable<typeof o> => o !== null);

		return c.json(observations);
	});

	// -------------------------------------------------------------------------
	// GET /api/observations/:id — Single observation
	// -------------------------------------------------------------------------

	app.get("/api/observations/:id", (c) => {
		const id = c.req.param("id");
		const observation = observationRepo.getById(id);
		if (!observation) {
			return c.json({ error: "Observation not found" }, 404);
		}
		return c.json(observation);
	});

	// -------------------------------------------------------------------------
	// GET /api/sessions — List sessions
	// -------------------------------------------------------------------------

	app.get("/api/sessions", (c) => {
		const limit = clampLimit(c.req.query("limit"), 20);
		const path = c.req.query("projectPath") || projectPath;
		const sessions = sessionRepo.getRecent(path, limit);
		return c.json(sessions);
	});

	// -------------------------------------------------------------------------
	// GET /api/sessions/:id — Session with observations
	// -------------------------------------------------------------------------

	app.get("/api/sessions/:id", (c) => {
		const id = c.req.param("id");
		const session = sessionRepo.getById(id);
		if (!session) {
			return c.json({ error: "Session not found" }, 404);
		}
		const observations = observationRepo.getBySession(id);
		return c.json({ ...session, observations });
	});

	// -------------------------------------------------------------------------
	// GET /api/search — Search observations
	// -------------------------------------------------------------------------

	app.get("/api/search", async (c) => {
		const q = c.req.query("q");
		if (!q) {
			return c.json({ error: "Query parameter 'q' is required" }, 400);
		}

		const type = validateType(c.req.query("type"));
		const limit = clampLimit(c.req.query("limit"), 20);

		try {
			if (embeddingModel) {
				const results = await hybridSearch(q, observationRepo, embeddingModel, {
					type,
					limit,
					projectPath,
				});
				return c.json(results);
			}

			const results = observationRepo.search({ query: q, type, limit });
			return c.json(results);
		} catch {
			return c.json([], 200);
		}
	});

	// -------------------------------------------------------------------------
	// GET /api/stats — Aggregate statistics
	// -------------------------------------------------------------------------

	app.get("/api/stats", (c) => {
		const totalObservations = observationRepo.getCount();
		const sessions = sessionRepo.getAll(projectPath);
		const totalSessions = sessions.length;

		const index = observationRepo.getIndex(projectPath, 10000);
		let totalTokenCount = 0;
		let totalDiscoveryTokens = 0;
		const typeBreakdown: Record<string, number> = {};

		for (const entry of index) {
			totalTokenCount += entry.tokenCount;
			totalDiscoveryTokens += entry.discoveryTokens;
			typeBreakdown[entry.type] = (typeBreakdown[entry.type] || 0) + 1;
		}

		const tokensSaved = totalDiscoveryTokens - totalTokenCount;
		const avgObservationSize = index.length > 0 ? Math.round(totalTokenCount / index.length) : 0;

		return c.json({
			totalObservations,
			totalSessions,
			tokensSaved,
			avgObservationSize,
			typeBreakdown,
		});
	});

	// -------------------------------------------------------------------------
	// GET /api/config — Current config (redacted)
	// -------------------------------------------------------------------------

	app.get("/api/config", (c) => {
		return c.json(redactConfig(config));
	});

	// -------------------------------------------------------------------------
	// SSE Route (must precede the catch-all)
	// -------------------------------------------------------------------------

	if (deps.sseHandler) {
		app.get("/api/events", deps.sseHandler);
	}

	// -------------------------------------------------------------------------
	// Static File Serving for SPA
	// -------------------------------------------------------------------------

	app.get("*", async (c) => {
		const path = c.req.path;

		if (path.startsWith("/api/")) {
			return c.json({ error: "Not found" }, 404);
		}

		const dashboardDir = new URL("../../dist/dashboard/", import.meta.url).pathname;
		const normalizedDir = normalize(dashboardDir);
		const safeDirPrefix = normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep;
		const cleanPath = path === "/" ? "index.html" : path.replace(/^\//, "");
		const filePath = resolve(dashboardDir, cleanPath);

		if (!filePath.startsWith(safeDirPrefix)) {
			return c.json({ error: "Not found" }, 404);
		}

		try {
			const file = Bun.file(filePath);
			if (await file.exists()) {
				return new Response(file);
			}
		} catch {}

		const indexPath = resolve(dashboardDir, "index.html");
		if (!indexPath.startsWith(safeDirPrefix)) {
			return c.json({ error: "Not found" }, 404);
		}

		try {
			const indexFile = Bun.file(indexPath);
			if (await indexFile.exists()) {
				return new Response(indexFile, {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}
		} catch {}

		return c.json({ error: "Dashboard not found. Run the dashboard build first." }, 404);
	});

	return app;
}
