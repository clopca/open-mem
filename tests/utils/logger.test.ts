// =============================================================================
// open-mem — Logger Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { Logger, type LogLevel } from "../../src/utils/logger";

describe("Logger", () => {
	const originalLog = console.log;
	const originalWarn = console.warn;
	const originalError = console.error;
	let logEntries: Array<{ method: string; args: unknown[] }>;

	function captureConsole(): void {
		logEntries = [];
		console.log = (...args: unknown[]) => {
			logEntries.push({ method: "log", args });
		};
		console.warn = (...args: unknown[]) => {
			logEntries.push({ method: "warn", args });
		};
		console.error = (...args: unknown[]) => {
			logEntries.push({ method: "error", args });
		};
	}

	afterEach(() => {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
	});

	test("default level is warn", () => {
		const logger = new Logger();
		expect(logger.getLevel()).toBe("warn");
	});

	test("debug messages suppressed at warn level", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.debug("test-debug");
		expect(logEntries).toHaveLength(0);
	});

	test("info messages suppressed at warn level", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.info("test-info");
		expect(logEntries).toHaveLength(0);
	});

	test("warn messages visible at warn level via console.warn", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.warn("test-warn");
		expect(logEntries).toHaveLength(1);
		expect(logEntries[0].method).toBe("warn");
		expect(logEntries[0].args[0]).toBe("[open-mem] test-warn");
	});

	test("error messages visible at warn level via console.error", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.error("test-error");
		expect(logEntries).toHaveLength(1);
		expect(logEntries[0].method).toBe("error");
		expect(logEntries[0].args[0]).toBe("[open-mem] test-error");
	});

	test("all messages visible at debug level", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.debug("a");
		logger.info("b");
		logger.warn("c");
		logger.error("d");
		expect(logEntries).toHaveLength(4);
	});

	test("debug and info use console.log", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.debug("a");
		logger.info("b");
		expect(logEntries[0].method).toBe("log");
		expect(logEntries[1].method).toBe("log");
	});

	test("warn uses console.warn", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.warn("c");
		expect(logEntries[0].method).toBe("warn");
	});

	test("error uses console.error", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.error("d");
		expect(logEntries[0].method).toBe("error");
	});

	test("only error visible at error level", () => {
		captureConsole();
		const logger = new Logger("error");
		logger.debug("a");
		logger.info("b");
		logger.warn("c");
		logger.error("d");
		expect(logEntries).toHaveLength(1);
		expect(logEntries[0].args[0]).toBe("[open-mem] d");
	});

	test("setLevel changes the active level", () => {
		captureConsole();
		const logger = new Logger("error");
		logger.warn("before");
		expect(logEntries).toHaveLength(0);

		logger.setLevel("debug");
		logger.warn("after");
		expect(logEntries).toHaveLength(1);
		expect(logEntries[0].args[0]).toBe("[open-mem] after");
	});

	test("all methods prefix with [open-mem]", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.debug("msg1");
		logger.info("msg2");
		logger.warn("msg3");
		logger.error("msg4");
		for (const entry of logEntries) {
			expect(entry.args[0]).toBeString();
			expect((entry.args[0] as string).startsWith("[open-mem] ")).toBe(true);
		}
	});

	test("passes extra arguments through", () => {
		captureConsole();
		const logger = new Logger("warn");
		const err = new Error("test");
		logger.warn("something failed:", err);
		expect(logEntries).toHaveLength(1);
		expect(logEntries[0].args[0]).toBe("[open-mem] something failed:");
		expect(logEntries[0].args[1]).toBe(err);
	});

	test("shouldLog returns correct boolean", () => {
		const logger = new Logger("warn");
		expect(logger.shouldLog("debug")).toBe(false);
		expect(logger.shouldLog("info")).toBe(false);
		expect(logger.shouldLog("warn")).toBe(true);
		expect(logger.shouldLog("error")).toBe(true);
	});
});
