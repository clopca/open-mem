import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultConfig, resolveConfig } from "../../src/config";

describe("Dashboard Configuration", () => {
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		savedEnv = { ...process.env };
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) delete process.env[key];
		}
		Object.assign(process.env, savedEnv);
	});

	test("resolveConfig includes dashboardEnabled: false by default", () => {
		delete process.env.OPEN_MEM_DASHBOARD;
		delete process.env.OPEN_MEM_DASHBOARD_PORT;

		const config = resolveConfig("/tmp/proj");

		expect(config.dashboardEnabled).toBe(false);
	});

	test("default dashboard port is 3737", () => {
		delete process.env.OPEN_MEM_DASHBOARD_PORT;

		const config = resolveConfig("/tmp/proj");

		expect(config.dashboardPort).toBe(3737);
	});

	test("OPEN_MEM_DASHBOARD=true sets dashboardEnabled: true", () => {
		process.env.OPEN_MEM_DASHBOARD = "true";

		const config = resolveConfig("/tmp/proj");

		expect(config.dashboardEnabled).toBe(true);
	});

	test("OPEN_MEM_DASHBOARD_PORT=4000 sets dashboardPort: 4000", () => {
		process.env.OPEN_MEM_DASHBOARD_PORT = "4000";

		const config = resolveConfig("/tmp/proj");

		expect(config.dashboardPort).toBe(4000);
	});

	test("getDefaultConfig includes dashboard fields", () => {
		const config = getDefaultConfig();

		expect(config.dashboardEnabled).toBe(false);
		expect(config.dashboardPort).toBe(3737);
	});
});
