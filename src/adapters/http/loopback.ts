const ALLOWED_LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function normalizeHostname(hostname: string): string {
	return hostname.trim().toLowerCase();
}

export function isLoopbackHostname(hostname: string): boolean {
	return ALLOWED_LOOPBACK_HOSTS.has(normalizeHostname(hostname));
}

export function assertLoopbackHostname(hostname: string, context: string): void {
	if (isLoopbackHostname(hostname)) return;
	throw new Error(
		`[open-mem] ${context} must bind to loopback only (127.0.0.1, ::1, localhost). Received "${hostname}".`,
	);
}
