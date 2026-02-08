import { normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { EmbeddingModel } from "ai";
import type { Context } from "hono";
import { Hono } from "hono";
import { fail, observationTypeSchema, ok } from "../../contracts/api";
import type { MemoryEngine } from "../../core/contracts";
import { getConfigSchema, getEffectiveConfig, patchConfig, previewConfig } from "../../config/store";
import type { ObservationType, OpenMemConfig } from "../../types";

export interface DashboardDeps {
  config: OpenMemConfig;
  projectPath: string;
  embeddingModel: EmbeddingModel | null;
  memoryEngine: MemoryEngine;
  sseHandler?: (c: Context) => Response | Promise<Response>;
  dashboardDir?: string;
}

const VALID_OBSERVATION_TYPES = new Set<string>(observationTypeSchema.options as readonly string[]);

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

function redactConfig(config: OpenMemConfig): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const lowerKey = key.toLowerCase();
    result[key] =
      typeof value === "string" && (lowerKey.includes("key") || lowerKey.includes("api"))
        ? "***REDACTED***"
        : value;
  }
  return result;
}

export function createDashboardApp(deps: DashboardDeps): Hono {
  const { config, projectPath, memoryEngine, dashboardDir: injectedDashboardDir } = deps;

  const app = new Hono();

  app.get("/v1/memory/observations", (c) => {
    const limit = clampLimit(c.req.query("limit"), 50);
    const offset = clampOffset(c.req.query("offset"));
    const type = validateType(c.req.query("type"));
    const sessionId = c.req.query("sessionId");
    const data = memoryEngine.listObservations({ limit, offset, type, sessionId });
    return c.json(ok(data, { limit, offset }));
  });

  app.post("/v1/memory/observations", async (c) => {
    try {
      const body = (await c.req.json()) as {
        title: string;
        narrative: string;
        type: ObservationType;
        concepts?: string[];
        files?: string[];
        importance?: number;
        scope?: "project" | "user";
        sessionId?: string;
      };
      const created = await memoryEngine.save({
        ...body,
        sessionId: body.sessionId ?? `http-${Date.now()}`,
      });
      if (!created) return c.json(fail("CONFLICT", "Unable to create observation"), 409);
      return c.json(ok(created), 201);
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid JSON body"), 400);
    }
  });

  app.get("/v1/memory/observations/:id", (c) => {
    const id = c.req.param("id");
    const observation = memoryEngine.getObservation(id);
    if (!observation) return c.json(fail("NOT_FOUND", "Observation not found"), 404);
    return c.json(ok(observation));
  });

  app.post("/v1/memory/observations/:id/revisions", async (c) => {
    const id = c.req.param("id");
    try {
      const body = (await c.req.json()) as Partial<{
        title: string;
        narrative: string;
        type: ObservationType;
        concepts: string[];
        importance: number;
      }>;
      const revised = await memoryEngine.update({ id, ...body });
      if (!revised) return c.json(fail("NOT_FOUND", "Observation not found"), 404);
      return c.json(ok({ previousId: id, newId: revised.id, observation: revised }));
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid JSON body"), 400);
    }
  });

  app.post("/v1/memory/observations/:id/tombstone", async (c) => {
    const id = c.req.param("id");
    const deleted = await memoryEngine.delete([id]);
    if (deleted === 0) return c.json(fail("NOT_FOUND", "Observation not found"), 404);
    return c.json(ok({ id, tombstoned: true }));
  });

  app.get("/v1/memory/sessions", (c) => {
    const limit = clampLimit(c.req.query("limit"), 20);
    const path = c.req.query("projectPath") || projectPath;
    return c.json(ok(memoryEngine.listSessions({ limit, projectPath: path }), { limit }));
  });

  app.get("/v1/memory/sessions/:id", (c) => {
    const id = c.req.param("id");
    const result = memoryEngine.getSession(id);
    if (!result) return c.json(fail("NOT_FOUND", "Session not found"), 404);
    return c.json(ok({ ...result.session, observations: result.observations, summary: result.summary }));
  });

  app.get("/v1/memory/search", async (c) => {
    const q = c.req.query("q");
    if (!q) return c.json(fail("VALIDATION_ERROR", "Query parameter 'q' is required"), 400);
    const type = validateType(c.req.query("type"));
    const limit = clampLimit(c.req.query("limit"), 20);
    try {
      const results = await memoryEngine.search(q, { type, limit });
      return c.json(ok(results, { limit }));
    } catch {
      return c.json(ok([], { limit }));
    }
  });

  app.post("/v1/memory/recall", async (c) => {
    try {
      const body = (await c.req.json()) as { ids: string[]; limit?: number };
      const observations = await memoryEngine.recall(body.ids ?? [], body.limit ?? 10);
      return c.json(ok(observations));
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid JSON body"), 400);
    }
  });

  app.post("/v1/memory/export", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { type?: ObservationType; limit?: number };
      const payload = await memoryEngine.export("project", { type: body.type, limit: body.limit });
      return c.json(ok(payload));
    } catch (error) {
      return c.json(fail("INTERNAL_ERROR", String(error)), 500);
    }
  });

  app.post("/v1/memory/import", async (c) => {
    try {
      const body = (await c.req.json()) as { payload: string; mode?: "skip" | "merge" | "replace" };
      const mode = body.mode === "replace" ? "overwrite" : "skip-duplicates";
      const result = await memoryEngine.import(body.payload, { mode });
      return c.json(ok(result));
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid import payload"), 400);
    }
  });

  app.get("/v1/memory/stats", (c) => {
    return c.json(ok(memoryEngine.stats()));
  });

  app.get("/v1/config/schema", (c) => c.json(ok(getConfigSchema())));

  app.get("/v1/config/effective", async (c) => {
    const effective = await getEffectiveConfig(projectPath);
    return c.json(
      ok({
        config: redactConfig(effective.config),
        meta: effective.meta,
        warnings: effective.warnings,
      }),
    );
  });

  app.post("/v1/config/preview", async (c) => {
    try {
      const body = (await c.req.json()) as Partial<OpenMemConfig>;
      const preview = await previewConfig(projectPath, body);
      return c.json(ok({ config: redactConfig(preview.config), meta: preview.meta, warnings: preview.warnings }));
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid JSON body"), 400);
    }
  });

  app.patch("/v1/config", async (c) => {
    try {
      const body = (await c.req.json()) as Partial<OpenMemConfig>;
      const effective = await patchConfig(projectPath, body);
      return c.json(ok({ config: redactConfig(effective.config), meta: effective.meta, warnings: effective.warnings }));
    } catch {
      return c.json(fail("VALIDATION_ERROR", "Invalid JSON body"), 400);
    }
  });

  const MODE_PRESETS: Record<string, Partial<OpenMemConfig>> = {
    balanced: { minOutputLength: 50, contextFullObservationCount: 3, maxObservations: 50, batchSize: 5 },
    focus: { minOutputLength: 120, contextFullObservationCount: 2, maxObservations: 30, batchSize: 3 },
    chill: { minOutputLength: 200, contextFullObservationCount: 1, maxObservations: 15, batchSize: 2, compressionEnabled: false },
  };

  app.get("/v1/modes", (c) =>
    c.json(ok({ modes: Object.entries(MODE_PRESETS).map(([id, patch]) => ({ id, patch })) })),
  );

  app.post("/v1/modes/:id/apply", async (c) => {
    const id = c.req.param("id");
    const preset = MODE_PRESETS[id];
    if (!preset) return c.json(fail("NOT_FOUND", "Unknown mode"), 404);
    const effective = await patchConfig(projectPath, preset);
    return c.json(ok({ applied: id, config: redactConfig(effective.config), meta: effective.meta, warnings: effective.warnings }));
  });

  app.post("/v1/maintenance/folder-context/dry-run", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { action?: "clean" | "rebuild" };
    const action = body.action ?? "clean";
    return c.json(ok(await memoryEngine.maintainFolderContext(action, true)));
  });

  app.post("/v1/maintenance/folder-context/clean", async (c) =>
    c.json(ok(await memoryEngine.maintainFolderContext("clean", false))),
  );
  app.post("/v1/maintenance/folder-context/rebuild", async (c) =>
    c.json(ok(await memoryEngine.maintainFolderContext("rebuild", false))),
  );

  if (deps.sseHandler) app.get("/v1/events", deps.sseHandler);

  app.get("*", async (c) => {
    const path = c.req.path;
    if (path.startsWith("/v1/")) return c.json(fail("NOT_FOUND", "Not found"), 404);

    const dashboardDir = injectedDashboardDir ?? resolve(fileURLToPath(import.meta.url), "../../dist/dashboard");
    const normalizedDir = normalize(dashboardDir);
    const safeDirPrefix = normalizedDir.endsWith(sep) ? normalizedDir : `${normalizedDir}${sep}`;

    const cleanPath = path === "/" ? "index.html" : path.replace(/^\//, "");
    const filePath = resolve(dashboardDir, cleanPath);
    if (!filePath.startsWith(safeDirPrefix)) return c.json(fail("NOT_FOUND", "Not found"), 404);

    try {
      const file = Bun.file(filePath);
      if (await file.exists()) return new Response(file);
    } catch {}

    const indexPath = resolve(dashboardDir, "index.html");
    if (!indexPath.startsWith(safeDirPrefix)) return c.json(fail("NOT_FOUND", "Not found"), 404);

    try {
      const indexFile = Bun.file(indexPath);
      if (await indexFile.exists()) {
        return new Response(indexFile, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    } catch {}

    return c.json(fail("NOT_FOUND", "Dashboard not found. Run the dashboard build first."), 404);
  });

  return app;
}
