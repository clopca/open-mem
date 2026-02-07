import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export function writePid(pidPath: string): void {
	const lastSlash = pidPath.lastIndexOf("/");
	if (lastSlash > 0) {
		const dir = pidPath.substring(0, lastSlash);
		mkdirSync(dir, { recursive: true });
	}
	writeFileSync(pidPath, String(process.pid), "utf-8");
}

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

export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function removePid(pidPath: string): void {
	try {
		unlinkSync(pidPath);
	} catch {
		// file may not exist
	}
}

export function getPidPath(dbPath: string): string {
	const lastSlash = dbPath.lastIndexOf("/");
	if (lastSlash >= 0) {
		return `${dbPath.substring(0, lastSlash)}/worker.pid`;
	}
	return "worker.pid";
}
