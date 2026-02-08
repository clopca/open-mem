import { describe, expect, test } from "bun:test";
import {
	createCommandEnvelope,
	createEventEnvelope,
	getBridgeHealth,
	isBridgeSuccess,
	parseBridgeResponse,
	sendBridgeHttpEvent,
} from "../../src/adapters/platform/bridge-client";

describe("platform bridge client", () => {
	test("builds event envelope", () => {
		const payload = { foo: "bar" };
		expect(createEventEnvelope(payload, "1")).toEqual({
			id: "1",
			command: "event",
			payload,
		});
	});

	test("builds command envelope", () => {
		expect(createCommandEnvelope("flush", 2)).toEqual({
			id: 2,
			command: "flush",
			payload: undefined,
		});
	});

	test("parses valid bridge response", () => {
		const parsed = parseBridgeResponse('{"ok":true,"code":"OK"}');
		expect(parsed.ok).toBe(true);
		expect(parsed.code).toBe("OK");
	});

	test("throws on invalid bridge response", () => {
		expect(() => parseBridgeResponse("{}"))
			.toThrowError(/missing boolean 'ok'/);
	});

	test("checks success by code", () => {
		expect(isBridgeSuccess({ ok: true, code: "OK" })).toBe(true);
		expect(isBridgeSuccess({ ok: false, code: "OK" })).toBe(false);
		expect(isBridgeSuccess({ ok: true, code: "OTHER" })).toBe(false);
	});

	test("sends HTTP event and parses response", async () => {
		const fakeFetch: typeof fetch = (async () =>
			new Response('{"ok":true,"code":"OK","ingested":true}', {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})) as typeof fetch;
		const resp = await sendBridgeHttpEvent(
			"http://127.0.0.1:37877",
			createEventEnvelope({ a: 1 }),
			fakeFetch,
		);
		expect(resp.ok).toBe(true);
		expect(resp.ingested).toBe(true);
	});

	test("reads HTTP health", async () => {
		const fakeFetch: typeof fetch = (async () =>
			new Response(
				'{"ok":true,"code":"OK","status":{"platform":"cursor","projectPath":"/tmp/p","queue":{"mode":"in-process","running":true,"processing":false,"pending":0}}}',
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)) as typeof fetch;
		const health = await getBridgeHealth("http://127.0.0.1:37877", fakeFetch);
		expect(health.ok).toBe(true);
		expect(health.status?.platform).toBe("cursor");
	});
});
