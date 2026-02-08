export type BridgeCommand = "event" | "flush" | "health" | "shutdown";

export interface BridgeEnvelope {
	id?: string | number;
	command?: BridgeCommand;
	payload?: unknown;
}

export interface BridgeStatus {
	platform: "opencode" | "claude-code" | "cursor";
	projectPath: string;
	queue: {
		mode: string;
		running: boolean;
		processing: boolean;
		pending: number;
	};
}

export interface BridgeResponse {
	id?: string | number;
	ok: boolean;
	code: string;
	message?: string;
	ingested?: boolean;
	processed?: number;
	status?: BridgeStatus;
}

export function createEventEnvelope(payload: unknown, id?: string | number): BridgeEnvelope {
	return { id, command: "event", payload };
}

export function createCommandEnvelope(
	command: Exclude<BridgeCommand, "event">,
	id?: string | number,
	payload?: unknown,
): BridgeEnvelope {
	return { id, command, payload };
}

export function parseBridgeResponse(input: string | unknown): BridgeResponse {
	const value = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid bridge response: expected object");
	}
	const obj = value as Record<string, unknown>;
	if (typeof obj.ok !== "boolean") {
		throw new Error("Invalid bridge response: missing boolean 'ok'");
	}
	if (typeof obj.code !== "string") {
		throw new Error("Invalid bridge response: missing string 'code'");
	}
	return {
		id: typeof obj.id === "string" || typeof obj.id === "number" ? obj.id : undefined,
		ok: obj.ok,
		code: obj.code,
		message: typeof obj.message === "string" ? obj.message : undefined,
		ingested: typeof obj.ingested === "boolean" ? obj.ingested : undefined,
		processed: typeof obj.processed === "number" ? obj.processed : undefined,
		status:
			obj.status && typeof obj.status === "object" && !Array.isArray(obj.status)
				? (obj.status as BridgeStatus)
				: undefined,
	};
}

export function isBridgeSuccess(
	response: BridgeResponse,
	allowedCodes: string[] = ["OK"],
): boolean {
	return response.ok && allowedCodes.includes(response.code);
}

export async function sendBridgeHttpEvent(
	baseUrl: string,
	envelope: BridgeEnvelope,
	fetchImpl: typeof fetch = fetch,
): Promise<BridgeResponse> {
	const url = `${baseUrl.replace(/\/$/, "")}/v1/events`;
	const resp = await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(envelope),
	});

	const text = await resp.text();
	let parsed: BridgeResponse;
	try {
		parsed = parseBridgeResponse(text);
	} catch {
		throw new Error(`Bridge HTTP response was not parseable JSON (status ${resp.status})`);
	}

	if (!resp.ok && parsed.ok) {
		return {
			...parsed,
			ok: false,
			code: "HTTP_ERROR",
			message: `HTTP status ${resp.status}`,
		};
	}

	return parsed;
}

export async function getBridgeHealth(
	baseUrl: string,
	fetchImpl: typeof fetch = fetch,
): Promise<BridgeResponse> {
	const url = `${baseUrl.replace(/\/$/, "")}/v1/health`;
	const resp = await fetchImpl(url, { method: "GET" });
	const text = await resp.text();
	const parsed = parseBridgeResponse(text);
	if (!resp.ok && parsed.ok) {
		return {
			...parsed,
			ok: false,
			code: "HTTP_ERROR",
			message: `HTTP status ${resp.status}`,
		};
	}
	return parsed;
}
