import { existsSync } from "node:fs";
import { getPidPath, isProcessAlive, readPid, removePid } from "./pid";

const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 2000;

interface DaemonManagerConfig {
	dbPath: string;
	projectPath: string;
	daemonScript: string;
}

export class DaemonManager {
	private readonly pidPath: string;
	private readonly projectPath: string;
	private readonly daemonScript: string;

	constructor(config: DaemonManagerConfig) {
		this.pidPath = getPidPath(config.dbPath);
		this.projectPath = config.projectPath;
		this.daemonScript = config.daemonScript;
	}

	start(): boolean {
		if (this.isRunning()) {
			return false;
		}

		const proc = Bun.spawn(["bun", "run", this.daemonScript, "--project", this.projectPath], {
			detached: true,
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.unref();

		const deadline = Date.now() + POLL_TIMEOUT_MS;
		while (Date.now() < deadline) {
			Bun.sleepSync(POLL_INTERVAL_MS);
			if (existsSync(this.pidPath)) {
				const pid = readPid(this.pidPath);
				if (pid !== null && isProcessAlive(pid)) {
					return true;
				}
			}
		}

		return false;
	}

	stop(): void {
		const pid = readPid(this.pidPath);
		if (pid !== null) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// process may already be dead
			}
		}
		removePid(this.pidPath);
	}

	isRunning(): boolean {
		const pid = readPid(this.pidPath);
		if (pid === null) {
			return false;
		}
		return isProcessAlive(pid);
	}

	getStatus(): { running: boolean; pid: number | null } {
		const pid = readPid(this.pidPath);
		if (pid === null) {
			return { running: false, pid: null };
		}
		if (!isProcessAlive(pid)) {
			return { running: false, pid: null };
		}
		return { running: true, pid };
	}
}
