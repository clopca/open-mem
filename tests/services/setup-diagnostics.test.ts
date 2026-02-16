import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "../../src/config";
import { DefaultSetupDiagnosticsService } from "../../src/services/setup-diagnostics";

describe("DefaultSetupDiagnosticsService", () => {
	test("returns fail when compression enabled without api key", () => {
		const config = { ...getDefaultConfig(), apiKey: undefined, compressionEnabled: true };
		const report = new DefaultSetupDiagnosticsService().run(config);
		expect(report.ok).toBe(false);
		expect(report.checks.some((check) => check.id === "provider-config" && check.status === "fail")).toBe(
			true,
		);
	});

	test("returns pass when provider configuration is valid", () => {
		const config = { ...getDefaultConfig(), apiKey: "test-key", compressionEnabled: true };
		const report = new DefaultSetupDiagnosticsService().run(config);
		expect(report.checks.some((check) => check.id === "provider-config" && check.status === "pass")).toBe(
			true,
		);
	});
});
