import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { OpenMemConfig } from "../types";

export interface DiagnosticCheck {
	id: string;
	status: "pass" | "warn" | "fail";
	message: string;
	details?: Record<string, unknown>;
}

export interface SetupDiagnosticsResult {
	ok: boolean;
	checks: DiagnosticCheck[];
}

export interface SetupDiagnosticsService {
	run(config: OpenMemConfig): SetupDiagnosticsResult;
}

export class DefaultSetupDiagnosticsService implements SetupDiagnosticsService {
	run(config: OpenMemConfig): SetupDiagnosticsResult {
		const checks: DiagnosticCheck[] = [];

		checks.push(this.checkDbDir(config));
		checks.push(this.checkProviderConfig(config));
		checks.push(this.checkVectorSupport(config));
		checks.push(this.checkAdapters(config));
		checks.push(this.checkDashboardPort(config));

		const ok = checks.every((check) => check.status !== "fail");
		return { ok, checks };
	}

	private checkDbDir(config: OpenMemConfig): DiagnosticCheck {
		const dir = dirname(config.dbPath);
		return existsSync(dir)
			? { id: "db-dir", status: "pass", message: "Database directory exists.", details: { dir } }
			: {
					id: "db-dir",
					status: "warn",
					message: "Database directory does not exist yet. It will be created on first run.",
					details: { dir },
				};
	}

	private checkProviderConfig(config: OpenMemConfig): DiagnosticCheck {
		if (!config.compressionEnabled) {
			return {
				id: "provider-config",
				status: "pass",
				message: "Compression is disabled; provider API key is optional.",
			};
		}
		if (config.provider === "bedrock") {
			return {
				id: "provider-config",
				status: "pass",
				message: "Bedrock provider selected; API key is not required.",
			};
		}
		if (!config.apiKey) {
			return {
				id: "provider-config",
				status: "fail",
				message: "Compression is enabled but no provider API key is configured.",
				details: { provider: config.provider },
			};
		}
		return {
			id: "provider-config",
			status: "pass",
			message: "Provider API key is configured.",
			details: { provider: config.provider },
		};
	}

	private checkVectorSupport(config: OpenMemConfig): DiagnosticCheck {
		const providerSupportsEmbeddings =
			config.provider === "google" || config.provider === "openai" || config.provider === "bedrock";
		if (!providerSupportsEmbeddings) {
			return {
				id: "vector-support",
				status: "warn",
				message: "Provider does not support embeddings; search will use FTS-only fallback.",
				details: { provider: config.provider },
			};
		}
		return {
			id: "vector-support",
			status: "pass",
			message: "Provider supports embeddings.",
			details: { provider: config.provider, dimension: config.embeddingDimension },
		};
	}

	private checkAdapters(config: OpenMemConfig): DiagnosticCheck {
		const enabled = [
			["opencode", config.platformOpenCodeEnabled !== false],
			["claude-code", config.platformClaudeCodeEnabled === true],
			["cursor", config.platformCursorEnabled === true],
		].filter(([, flag]) => flag);

		if (enabled.length === 0) {
			return {
				id: "adapters",
				status: "fail",
				message: "No platform adapters are enabled.",
			};
		}

		return {
			id: "adapters",
			status: "pass",
			message: `Enabled adapters: ${enabled.map(([name]) => name).join(", ")}`,
		};
	}

	private checkDashboardPort(config: OpenMemConfig): DiagnosticCheck {
		if (!config.dashboardEnabled) {
			return { id: "dashboard", status: "pass", message: "Dashboard is disabled." };
		}
		if (config.dashboardPort < 1 || config.dashboardPort > 65535) {
			return {
				id: "dashboard",
				status: "fail",
				message: "Dashboard port is outside the valid range (1-65535).",
				details: { dashboardPort: config.dashboardPort },
			};
		}
		return {
			id: "dashboard",
			status: "pass",
			message: "Dashboard port configuration looks valid.",
			details: { dashboardPort: config.dashboardPort },
		};
	}
}
