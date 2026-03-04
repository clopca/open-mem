import { existsSync } from "node:fs";
import { resolveBunPathCached } from "../utils/bun-path";
import {
	getKnownProcessPidFiles,
	getPidLiveness,
	getPidPath,
	isProcessAlive,
	type KnownProcessType,
	readPid,
	removePid,
} from "./pid";

const POLL_INTERVAL_MS = 100;
const POLL_TIMEOUT_MS = 2000;

interface DaemonManagerConfig {
	dbPath: string;
	projectPath: string;
	daemonScript: string;
}

export interface DaemonStatus {
	state: "running" | "missing" | "dead";
	running: boolean;
	pid: number | null;
	stalePid: number | null;
	stalePidRemoved: boolean;
}

export interface DaemonSignalResult {
	ok: boolean;
	state: "delivered" | "no-daemon" | "daemon-dead" | "unsupported-signal" | "delivery-failed";
	via: "ipc" | "os-signal" | "none";
	pid: number | null;
	message: string;
	error?: string;
}

export interface MaintenancePreflightProcessStatus {
	processType: KnownProcessType;
	state: "running" | "missing" | "dead";
	running: boolean;
	pidPath: string;
	pid: number | null;
	stalePid: number | null;
	stalePidRemoved: boolean;
}

export interface MaintenancePreflightStatus {
	blocked: boolean;
	activeProcesses: MaintenancePreflightProcessStatus[];
	checks: MaintenancePreflightProcessStatus[];
}

export function getMaintenancePreflightStatus(dbPath: string): MaintenancePreflightStatus {
	const checks = getKnownProcessPidFiles(dbPath).map(({ type, pidPath }) => {
		if (type === "daemon") {
			const daemonStatus = getDaemonStatusFromPidPath(pidPath, false);
			return {
				processType: type,
				state: daemonStatus.state,
				running: daemonStatus.running,
				pidPath,
				pid: daemonStatus.pid,
				stalePid: daemonStatus.stalePid,
				stalePidRemoved: daemonStatus.stalePidRemoved,
			};
		}

		const liveness = getPidLiveness(pidPath, false);
		if (liveness.state === "alive") {
			return {
				processType: type,
				state: "running" as const,
				running: true,
				pidPath,
				pid: liveness.pid,
				stalePid: null,
				stalePidRemoved: false,
			};
		}

		if (liveness.state === "dead") {
			return {
				processType: type,
				state: "dead" as const,
				running: false,
				pidPath,
				pid: null,
				stalePid: liveness.stalePid,
				stalePidRemoved: liveness.stalePidRemoved,
			};
		}

		return {
			processType: type,
			state: "missing" as const,
			running: false,
			pidPath,
			pid: null,
			stalePid: null,
			stalePidRemoved: false,
		};
	});

	const activeProcesses = checks.filter((status) => status.running);
	return {
		blocked: activeProcesses.length > 0,
		activeProcesses,
		checks,
	};
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

	signal(message: string): DaemonSignalResult {
		const readStatusSafely = (): DaemonStatus | null => {
			try {
				return this.getStatus();
			} catch {
				return null;
			}
		};

		try {
			if (this.subprocess) {
				this.subprocess.send(message);
				const status = readStatusSafely();
				return {
					ok: true,
					state: "delivered",
					via: "ipc",
					pid: status?.pid ?? null,
					message,
				};
			}
			if (message !== "PROCESS_NOW") {
				return {
					ok: false,
					state: "unsupported-signal",
					via: "none",
					pid: null,
					message,
				};
			}
			const status = this.getStatus();
			if (status.state === "missing") {
				return {
					ok: false,
					state: "no-daemon",
					via: "none",
					pid: null,
					message,
				};
			}
			if (status.state === "dead") {
				return {
					ok: false,
					state: "daemon-dead",
					via: "none",
					pid: status.stalePid,
					message,
				};
			}
			if (status.pid !== null) {
				process.kill(status.pid, "SIGUSR1");
				return {
					ok: true,
					state: "delivered",
					via: "os-signal",
					pid: status.pid,
					message,
				};
			}
			return {
				ok: false,
				state: "delivery-failed",
				via: "none",
				pid: null,
				message,
				error: "Daemon was reported running but did not expose a PID",
			};
		} catch (error: unknown) {
			const status = readStatusSafely();
			return {
				ok: false,
				state: "delivery-failed",
				via: "none",
				pid: status?.pid ?? null,
				message,
				error: String(error),
			};
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
		return this.getStatus().running;
	}

	getStatus(): DaemonStatus {
		return getDaemonStatusFromPidPath(this.pidPath, true);
	}
}

function getDaemonStatusFromPidPath(pidPath: string, removeStale: boolean): DaemonStatus {
	const liveness = getPidLiveness(pidPath, removeStale);
	if (liveness.state === "missing") {
		return {
			state: "missing",
			running: false,
			pid: null,
			stalePid: null,
			stalePidRemoved: false,
		};
	}
	if (liveness.state === "dead") {
		return {
			state: "dead",
			running: false,
			pid: null,
			stalePid: liveness.stalePid,
			stalePidRemoved: liveness.stalePidRemoved,
		};
	}
	return {
		state: "running",
		running: true,
		pid: liveness.pid,
		stalePid: null,
		stalePidRemoved: false,
	};
}
