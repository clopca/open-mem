// =============================================================================
// open-mem — Logger Tests
// =============================================================================

import { afterEach, describe, expect, test } from "bun:test";
import { Logger, type LogLevel } from "../../src/utils/logger";

describe("Logger", () => {
	const originalError = console.error;
	let logged: unknown[][];

	function captureConsole(): void {
		logged = [];
		console.error = (...args: unknown[]) => {
			logged.push(args);
		};
	}

	afterEach(() => {
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
		expect(logged).toHaveLength(0);
	});

	test("info messages suppressed at warn level", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.info("test-info");
		expect(logged).toHaveLength(0);
	});

	test("warn messages visible at warn level", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.warn("test-warn");
		expect(logged).toHaveLength(1);
		expect(logged[0][0]).toBe("[open-mem] test-warn");
	});

	test("error messages visible at warn level", () => {
		captureConsole();
		const logger = new Logger("warn");
		logger.error("test-error");
		expect(logged).toHaveLength(1);
		expect(logged[0][0]).toBe("[open-mem] test-error");
	});

	test("all messages visible at debug level", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.debug("a");
		logger.info("b");
		logger.warn("c");
		logger.error("d");
		expect(logged).toHaveLength(4);
	});

	test("only error visible at error level", () => {
		captureConsole();
		const logger = new Logger("error");
		logger.debug("a");
		logger.info("b");
		logger.warn("c");
		logger.error("d");
		expect(logged).toHaveLength(1);
		expect(logged[0][0]).toBe("[open-mem] d");
	});

	test("setLevel changes the active level", () => {
		captureConsole();
		const logger = new Logger("error");
		logger.warn("before");
		expect(logged).toHaveLength(0);

		logger.setLevel("debug");
		logger.warn("after");
		expect(logged).toHaveLength(1);
		expect(logged[0][0]).toBe("[open-mem] after");
	});

	test("all methods prefix with [open-mem]", () => {
		captureConsole();
		const logger = new Logger("debug");
		logger.debug("msg1");
		logger.info("msg2");
		logger.warn("msg3");
		logger.error("msg4");
		for (const entry of logged) {
			expect(entry[0]).toBeString();
			expect((entry[0] as string).startsWith("[open-mem] ")).toBe(true);
		}
	});

	test("passes extra arguments through", () => {
		captureConsole();
		const logger = new Logger("warn");
		const err = new Error("test");
		logger.warn("something failed:", err);
		expect(logged).toHaveLength(1);
		expect(logged[0][0]).toBe("[open-mem] something failed:");
		expect(logged[0][1]).toBe(err);
	});

	test("shouldLog returns correct boolean", () => {
		const logger = new Logger("warn");
		expect(logger.shouldLog("debug")).toBe(false);
		expect(logger.shouldLog("info")).toBe(false);
		expect(logger.shouldLog("warn")).toBe(true);
		expect(logger.shouldLog("error")).toBe(true);
	});
});
