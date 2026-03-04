import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPidPath } from "../../src/daemon/pid";
import { createDatabase } from "../../src/db/database";

const cleanupDirs: string[] = [];

function createTempProject(): { projectPath: string; dbPath: string } {
	const projectPath = `/tmp/open-mem-maintenance-test-${randomUUID()}`;
	const dbPath = join(projectPath, ".open-mem", "memory.db");
	mkdirSync(join(projectPath, ".open-mem"), { recursive: true });
	cleanupDirs.push(projectPath);
	return { projectPath, dbPath };
}

function createDbArtifacts(dbPath: string): void {
	writeFileSync(dbPath, "db", "utf8");
	writeFileSync(`${dbPath}-wal`, "wal", "utf8");
	writeFileSync(`${dbPath}-shm`, "shm", "utf8");
}

function markDaemonRunning(dbPath: string): void {
	const pidPath = getPidPath(dbPath);
	writeFileSync(pidPath, String(process.pid), "utf8");
}

async function runResetDb(projectPath: string, extraArgs: string[] = []) {
	return runMaintenanceCommand(["reset-db", "--project", projectPath, ...extraArgs]);
}

async function runMaintenanceCommand(args: string[]) {
	const proc = Bun.spawn([process.execPath, "run", "src/maintenance.ts", ...args], {
		cwd: join(import.meta.dir, "../.."),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

function createSQLiteDb(dbPath: string): void {
	const db = createDatabase(dbPath, { processRole: "maintenance" });
	db.exec("CREATE TABLE IF NOT EXISTS maintenance_probe (id INTEGER PRIMARY KEY, value TEXT)");
	db.run("INSERT INTO maintenance_probe (value) VALUES (?)", ["seed"]);
	db.close();
}

afterEach(() => {
	for (const dir of cleanupDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("maintenance reset-db safety gates", () => {
	test("test_documented_reset_block_behavior_matches_cli", async () => {
		const { projectPath, dbPath } = createTempProject();
		createDbArtifacts(dbPath);
		markDaemonRunning(dbPath);
		const readme = readFileSync(join(import.meta.dir, "../../README.md"), "utf8");

		const result = await runResetDb(projectPath);

		expect(readme).toContain("Safe-by-default reset");
		expect(readme).toContain("blocked when active processes are detected");
		expect(readme).toContain("bunx open-mem-maintenance reset-db --project /path/to/project");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("[open-mem] reset-db blocked: active processes detected.");
		expect(existsSync(dbPath)).toBe(true);
		expect(result.stdout).not.toContain("Removed database files for");
	});

	test("test_documented_force_behavior_matches_cli", async () => {
		const { projectPath, dbPath } = createTempProject();
		createDbArtifacts(dbPath);
		markDaemonRunning(dbPath);
		const readme = readFileSync(join(import.meta.dir, "../../README.md"), "utf8");

		const result = await runResetDb(projectPath, ["--force"]);

		expect(readme).toContain("Explicit destructive override");
		expect(readme).toContain("reset-db --project /path/to/project --force");
		expect(result.exitCode).toBe(0);
		expect(result.stderr).toContain(
			"[open-mem] WARNING: --force set, continuing with destructive reset.",
		);
		expect(result.stdout).toContain("Removed database files for");
		expect(existsSync(dbPath)).toBe(false);
		expect(existsSync(`${dbPath}-wal`)).toBe(false);
		expect(existsSync(`${dbPath}-shm`)).toBe(false);
	});

	test("blocked reset output includes remediation guidance", async () => {
		const { projectPath, dbPath } = createTempProject();
		createDbArtifacts(dbPath);
		markDaemonRunning(dbPath);

		const result = await runResetDb(projectPath);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("[open-mem] Remediation:");
		expect(result.stderr).toContain("Stop daemon and platform workers for this project");
		expect(result.stderr).toContain("Retry reset-db after processes exit");
		expect(result.stderr).toContain("rerun with --force");
	});

	test("docs include stop-retry-force remediation sequence aligned with cli output", async () => {
		const { projectPath, dbPath } = createTempProject();
		createDbArtifacts(dbPath);
		markDaemonRunning(dbPath);
		const readme = readFileSync(join(import.meta.dir, "../../README.md"), "utf8");
		const troubleshooting = readFileSync(
			join(import.meta.dir, "../../docs/troubleshooting.md"),
			"utf8",
		);

		const result = await runResetDb(projectPath);

		expect(readme).toContain("Stop daemon and platform workers for this project");
		expect(readme).toContain("Retry reset-db after processes exit");
		expect(readme).toContain("rerun with --force");
		expect(troubleshooting).toContain("When `reset-db` is blocked, follow the remediation");
		expect(troubleshooting).toContain("Stop daemon and platform workers for this project");
		expect(troubleshooting).toContain("Retry `reset-db` after processes exit");
		expect(troubleshooting).toContain("rerun with `--force`");
		expect(result.stderr).toContain("Stop daemon and platform workers for this project");
		expect(result.stderr).toContain("Retry reset-db after processes exit");
		expect(result.stderr).toContain("rerun with --force");
	});

	test("platform docs define daemon-aware enqueue-only and in-process expectations", () => {
		const platformDocs = readFileSync(join(import.meta.dir, "../../docs/platforms.md"), "utf8");

		expect(platformDocs).toContain("`enqueue-only`: daemon is enabled and running");
		expect(platformDocs).toContain("signals `PROCESS_NOW` to the daemon");
		expect(platformDocs).toContain("`in-process`: worker processes batches locally");
		expect(platformDocs).toContain(
			"Workers run in `in-process` when daemon mode is disabled, daemon startup/liveness is unavailable, or daemon signaling fails",
		);
		expect(platformDocs).toContain("falls back to `in-process` automatically");
	});

	test("test_cli_maintenance_non_destructive_flow", async () => {
		const { projectPath, dbPath } = createTempProject();
		createSQLiteDb(dbPath);

		const checkpointResult = await runMaintenanceCommand([
			"sqlite",
			"checkpoint",
			"--project",
			projectPath,
		]);
		const integrityResult = await runMaintenanceCommand([
			"sqlite",
			"integrity",
			"--project",
			projectPath,
		]);

		expect(checkpointResult.exitCode).toBe(0);
		expect(checkpointResult.stdout).toContain('"operation": "wal_checkpoint"');
		expect(checkpointResult.stdout).toContain('"status": "ok"');
		expect(checkpointResult.stdout).not.toContain("Removed database files for");
		expect(integrityResult.exitCode).toBe(0);
		expect(integrityResult.stdout).toContain('"operation": "integrity_check"');
		expect(integrityResult.stdout).toContain('"status": "ok"');
		expect(integrityResult.stdout).not.toContain("Removed database files for");
		expect(existsSync(dbPath)).toBe(true);
	});

	test("sqlite integrity command returns structured success output", async () => {
		const { projectPath, dbPath } = createTempProject();
		createSQLiteDb(dbPath);

		const result = await runMaintenanceCommand([
			"sqlite",
			"integrity",
			"--project",
			projectPath,
			"--max-errors",
			"5",
		]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain('"operation": "integrity_check"');
		expect(result.stdout).toContain('"status": "ok"');
		expect(existsSync(dbPath)).toBe(true);
	});

	test("sqlite maintenance failure output includes operation reason and guidance", async () => {
		const { projectPath, dbPath } = createTempProject();
		createSQLiteDb(dbPath);

		const result = await runMaintenanceCommand([
			"sqlite",
			"checkpoint",
			"--project",
			projectPath,
			"--mode",
			"BADMODE",
		]);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain('"operation": "wal_checkpoint"');
		expect(result.stderr).toContain('"reason": "Invalid checkpoint mode: BADMODE"');
		expect(result.stderr).toContain("Use one of: PASSIVE, FULL, RESTART, TRUNCATE");
		expect(existsSync(dbPath)).toBe(true);
	});
});
