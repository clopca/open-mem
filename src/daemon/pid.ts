import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/** Write the current process PID to the given file path. */
export function writePid(pidPath: string): void {
	const lastSlash = pidPath.lastIndexOf("/");
	if (lastSlash > 0) {
		const dir = pidPath.substring(0, lastSlash);
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(pidPath, String(process.pid), "utf-8");
}

/** Read a PID from file, returning null if missing or invalid. */
export function readPid(pidPath: string): number | null {
	if (!existsSync(pidPath)) {
		return null;
	}
	const content = readFileSync(pidPath, "utf-8").trim();
	const pid = Number.parseInt(content, 10);
	if (Number.isNaN(pid)) {
		return null;
	}
	return pid;
}

/** Check whether a process with the given PID is still running. */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err: unknown) {
		// EPERM means the process exists but we lack permission to signal it
		if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EPERM") {
			return true;
		}
		return false; // ESRCH or other → process does not exist
	}
}

/** Remove a PID file, ignoring errors if it doesn't exist. */
export function removePid(pidPath: string): void {
	try {
		unlinkSync(pidPath);
	} catch {
		// file may not exist
	}
}

/** Derive the PID file path from the database path. */
export function getPidPath(dbPath: string): string {
	const lastSlash = dbPath.lastIndexOf("/");
	if (lastSlash >= 0) {
		return `${dbPath.substring(0, lastSlash)}/worker.pid`;
	}
	return "worker.pid";
}
