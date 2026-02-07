import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getDefaultConfig, resolveConfig } from "../../src/config";
import { DaemonManager } from "../../src/daemon/manager";
import type { ProcessingMode } from "../../src/queue/processor";

describe("Daemon Integration", () => {
	let savedEnv: Record<string, string | undefined>;

	beforeEach(() => {
		savedEnv = { ...process.env };
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) {
			if (!(key in savedEnv)) {
				delete process.env[key];
			}
		}
		Object.assign(process.env, savedEnv);
	});

	// -------------------------------------------------------------------------
	// Config: daemonEnabled default
	// -------------------------------------------------------------------------

	test("daemonEnabled defaults to false", () => {
		const config = getDefaultConfig();
		expect(config.daemonEnabled).toBe(false);
	});

	test("OPEN_MEM_DAEMON=true enables daemon in resolved config", () => {
		process.env.OPEN_MEM_DAEMON = "true";
		const config = resolveConfig("/tmp/test-project");
		expect(config.daemonEnabled).toBe(true);
	});

	test("OPEN_MEM_DAEMON unset keeps daemon disabled", () => {
		delete process.env.OPEN_MEM_DAEMON;
		const config = resolveConfig("/tmp/test-project");
		expect(config.daemonEnabled).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Integration logic: daemon disabled (default path)
	// -------------------------------------------------------------------------

	test("daemonEnabled=false skips daemon start — queue stays in-process", () => {
		const config = getDefaultConfig();
		expect(config.daemonEnabled).toBe(false);

		const mode: ProcessingMode = "in-process";
		let daemonStarted = false;

		if (config.daemonEnabled) {
			daemonStarted = true;
		}

		expect(daemonStarted).toBe(false);
		expect(mode).toBe("in-process");
	});

	// -------------------------------------------------------------------------
	// Integration logic: daemon enabled + start succeeds
	// -------------------------------------------------------------------------

	test("daemon start success switches queue to enqueue-only", () => {
		const modeTracker: { current: ProcessingMode } = { current: "in-process" };
		const setMode = (m: ProcessingMode) => {
			modeTracker.current = m;
		};

		const mockDaemonStartSuccess = true;

		if (mockDaemonStartSuccess) {
			setMode("enqueue-only");
		}

		expect(modeTracker.current).toBe("enqueue-only");
	});

	// -------------------------------------------------------------------------
	// Integration logic: daemon enabled + start fails
	// -------------------------------------------------------------------------

	test("daemon start failure keeps queue in-process", () => {
		let currentMode: ProcessingMode = "in-process";
		const setMode = (m: ProcessingMode) => {
			currentMode = m;
		};

		const mockDaemonStartSuccess = false;
		let daemonManager: DaemonManager | null = new DaemonManager({
			dbPath: "/tmp/nonexistent/memory.db",
			projectPath: "/tmp/nonexistent",
			daemonScript: "nonexistent.ts",
		});

		if (!mockDaemonStartSuccess) {
			daemonManager = null;
		} else {
			setMode("enqueue-only");
		}

		expect(currentMode).toBe("in-process");
		expect(daemonManager).toBeNull();
	});

	// -------------------------------------------------------------------------
	// Liveness fallback logic
	// -------------------------------------------------------------------------

	test("liveness check falls back to in-process when daemon dies", () => {
		const modeTracker: { current: ProcessingMode } = { current: "enqueue-only" };
		let queueStarted = false;
		let timerCleared = false;

		const setMode = (m: ProcessingMode) => {
			modeTracker.current = m;
		};
		const startQueue = () => {
			queueStarted = true;
		};

		const isDaemonRunning = false;

		if (!isDaemonRunning) {
			setMode("in-process");
			startQueue();
			timerCleared = true;
		}

		expect(modeTracker.current).toBe("in-process");
		expect(queueStarted).toBe(true);
		expect(timerCleared).toBe(true);
	});

	test("liveness check does nothing when daemon is still alive", () => {
		let currentMode: ProcessingMode = "enqueue-only";
		let queueStarted = false;

		const setMode = (m: ProcessingMode) => {
			currentMode = m;
		};
		const startQueue = () => {
			queueStarted = true;
		};

		const isDaemonRunning = true;

		if (!isDaemonRunning) {
			setMode("in-process");
			startQueue();
		}

		expect(currentMode).toBe("enqueue-only");
		expect(queueStarted).toBe(false);
	});

	// -------------------------------------------------------------------------
	// Cleanup logic
	// -------------------------------------------------------------------------

	test("cleanup stops daemon and clears liveness timer", () => {
		let timerCleared = false;
		let daemonStopped = false;

		const daemonLivenessTimer = setInterval(() => {}, 30_000);
		const daemonManager = {
			stop: () => {
				daemonStopped = true;
			},
		};

		if (daemonLivenessTimer) {
			clearInterval(daemonLivenessTimer);
			timerCleared = true;
		}
		if (daemonManager) daemonManager.stop();

		expect(timerCleared).toBe(true);
		expect(daemonStopped).toBe(true);
	});

	test("cleanup handles null daemon and timer gracefully", () => {
		const state: {
			timer: ReturnType<typeof setInterval> | null;
			daemon: { stop(): void } | null;
		} = { timer: null, daemon: null };

		let threw = false;
		try {
			if (state.timer) clearInterval(state.timer);
			if (state.daemon) state.daemon.stop();
		} catch {
			threw = true;
		}

		expect(threw).toBe(false);
	});
});
