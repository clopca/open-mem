// =============================================================================
// open-mem — Configurable Logger
// =============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

/**
 * Lightweight logger that respects the configured log level.
 *
 * Each level routes to the semantically appropriate console method:
 * - `debug` / `info` → `console.log` (stdout)
 * - `warn` → `console.warn` (stderr, but distinct from error)
 * - `error` → `console.error` (stderr)
 *
 * All messages are gated by the configured level. At the default `warn` level,
 * `debug` and `info` messages are suppressed.
 */
export class Logger {
	private level: LogLevel;

	constructor(level: LogLevel = "warn") {
		this.level = level;
	}

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	getLevel(): LogLevel {
		return this.level;
	}

	shouldLog(level: LogLevel): boolean {
		return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.shouldLog("debug")) {
			console.log(`[open-mem] ${message}`, ...args);
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.shouldLog("info")) {
			console.log(`[open-mem] ${message}`, ...args);
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.shouldLog("warn")) {
			console.warn(`[open-mem] ${message}`, ...args);
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.shouldLog("error")) {
			console.error(`[open-mem] ${message}`, ...args);
		}
	}
}
