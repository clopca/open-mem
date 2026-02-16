import { describe, expect, test } from "bun:test";
import { DefaultReadinessService } from "../../src/services/readiness";
import { getDefaultConfig } from "../../src/config";

describe("DefaultReadinessService", () => {
	test("reports ready when runtime is healthy and an adapter is enabled", () => {
		const config = { ...getDefaultConfig(), apiKey: "test-key" };
		const readiness = new DefaultReadinessService().evaluate({
			config,
			adapterStatuses: [{ name: "opencode", enabled: true }],
			runtime: { status: "ok", queue: { lastError: null } },
		});
		expect(readiness.ready).toBe(true);
		expect(readiness.status).toBe("ready");
	});

	test("reports degraded when runtime has queue error", () => {
		const config = { ...getDefaultConfig(), apiKey: "test-key" };
		const readiness = new DefaultReadinessService().evaluate({
			config,
			adapterStatuses: [{ name: "opencode", enabled: true }],
			runtime: { status: "degraded", queue: { lastError: "boom" } },
		});
		expect(readiness.ready).toBe(false);
		expect(readiness.status).toBe("degraded");
		expect(readiness.reasons.length).toBeGreaterThan(0);
	});
});
