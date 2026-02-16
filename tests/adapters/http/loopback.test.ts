import { describe, expect, test } from "bun:test";
import { assertLoopbackHostname, isLoopbackHostname } from "../../../src/adapters/http/loopback";

describe("loopback hostname guard", () => {
	test("accepts loopback hostnames", () => {
		expect(isLoopbackHostname("127.0.0.1")).toBe(true);
		expect(isLoopbackHostname("::1")).toBe(true);
		expect(isLoopbackHostname("localhost")).toBe(true);
		expect(isLoopbackHostname(" LOCALHOST ")).toBe(true);
	});

	test("rejects non-loopback hostnames", () => {
		expect(isLoopbackHostname("0.0.0.0")).toBe(false);
		expect(isLoopbackHostname("192.168.1.20")).toBe(false);
		expect(isLoopbackHostname("example.com")).toBe(false);
	});

	test("throws explicit error for non-loopback binding", () => {
		expect(() => assertLoopbackHostname("0.0.0.0", "Dashboard server")).toThrow(
			/Dashboard server must bind to loopback only/,
		);
	});
});
