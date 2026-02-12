import { existsSync } from "node:fs";
import { resolveBunPathCached } from "../utils/bun-path";
import { getPidPath, isProcessAlive, readPid, removePid } from "./pid";

const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 2000;

interface DaemonManagerConfig {
	dbPath: string;
	projectPath: string;
	daemonScript: string;
}

/** Manages the lifecycle of a background daemon subprocess for queue processing. */
export class DaemonManager {
	private readonly pidPath: string;
	private readonly projectPath: string;
	private readonly daemonScript: string;
	private subprocess: ReturnType<typeof Bun.spawn> | null = null;

	constructor(config: DaemonManagerConfig) {
		this.pidPath = getPidPath(config.dbPath);
		this.projectPath = config.projectPath;
		this.daemonScript = config.daemonScript;
	}

	start(): boolean {
		if (this.isRunning()) {
			return false;
		}

		this.subprocess = Bun.spawn(
			[resolveBunPathCached(), "run", this.daemonScript, "--project", this.projectPath],
			{
				detached: true,
				stdio: ["ignore", "ignore", "ignore"],
				ipc(_message) {
					// No-op — we only send messages to the child, not receive
				},
			},
		);
		this.subprocess.unref();

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

	signal(message: string): void {
		try {
			this.subprocess?.send(message);
		} catch {
			// IPC failure is non-fatal — daemon may have died
		}
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
		this.subprocess = null;
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
