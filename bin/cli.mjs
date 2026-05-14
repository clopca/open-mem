#!/usr/bin/env node

// open-mem — Plugin Installer for OpenCode
// Usage: npx open-mem [--global] [--force] [--quick] [--uninstall] [--dry-run] [--help] [--version]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

// ── colour helpers (disabled when piped) ────────────────────────────
const isTTY = process.stdout.isTTY;
const RED = isTTY ? "\x1b[0;31m" : "";
const GREEN = isTTY ? "\x1b[0;32m" : "";
const YELLOW = isTTY ? "\x1b[0;33m" : "";
const BLUE = isTTY ? "\x1b[0;34m" : "";
const DIM = isTTY ? "\x1b[2m" : "";
const BOLD = isTTY ? "\x1b[1m" : "";
const RESET = isTTY ? "\x1b[0m" : "";

const info = (msg) => process.stdout.write(`${BLUE}[info]${RESET}  ${msg}\n`);
const ok = (msg) => process.stdout.write(`${GREEN}[ok]${RESET}    ${msg}\n`);
const warn = (msg) => process.stdout.write(`${YELLOW}[warn]${RESET}  ${msg}\n`);
const err = (msg) => process.stderr.write(`${RED}[error]${RESET} ${msg}\n`);

// ── constants ───────────────────────────────────────────────────────
const PLUGIN_ENTRY = "open-mem@latest";
const PKG_NAME = "open-mem";
const DOCS_URL = "https://github.com/clopca/open-mem";

// ── CLI flags ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flagGlobal = args.includes("--global");
const flagUninstall = args.includes("--uninstall");
const flagDryRun = args.includes("--dry-run");
const flagForce = args.includes("--force");
const flagHelp = args.includes("--help") || args.includes("-h");
const flagVersion = args.includes("--version") || args.includes("-v");
const flagQuick = args.includes("--quick");

// ── unknown flag validation ─────────────────────────────────────────
const KNOWN_FLAGS = new Set([
	"--global",
	"--uninstall",
	"--dry-run",
	"--force",
	"--quick",
	"--help",
	"-h",
	"--version",
	"-v",
]);
const unknown = args.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.has(a));
if (unknown.length > 0) {
	err(`Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`);
	info(`Run ${BOLD}npx open-mem --help${RESET} for usage.`);
	process.exit(1);
}

// ── version helper ──────────────────────────────────────────────────

function getVersion() {
	try {
		const pkgPath = path.join(
			path.dirname(new URL(import.meta.url).pathname),
			"..",
			"package.json",
		);
		return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
	} catch {
		return null;
	}
}

// ── --version flag ──────────────────────────────────────────────────
if (flagVersion) {
	const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "package.json");
	try {
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
		process.stdout.write(`${pkg.name} v${pkg.version}\n`);
	} catch {
		process.stdout.write(`open-mem (version unknown)\n`);
	}
	process.exit(0);
}

// ── help ────────────────────────────────────────────────────────────
if (flagHelp) {
	process.stdout.write(`
${BOLD}open-mem${RESET} — Persistent memory plugin for OpenCode

${BOLD}USAGE${RESET}
  npx open-mem [flags]

${BOLD}FLAGS${RESET}
  ${DIM}(none)${RESET}        Interactive setup wizard (TTY only)
  --quick       Skip wizard, install directly (non-interactive)
  --global      Target ~/.config/opencode/opencode.json instead
  --uninstall   Remove open-mem from all discovered config files
  --dry-run     Preview changes without writing anything
  --force       Skip confirmation prompts
  --help, -h    Show this help
  --version, -v Show version

${BOLD}EXAMPLES${RESET}
  npx open-mem                 ${DIM}# install locally${RESET}
  npx open-mem --global        ${DIM}# install globally${RESET}
  npx open-mem --uninstall     ${DIM}# remove from all configs${RESET}

${BOLD}DOCS${RESET}
  ${DOCS_URL}
`);
	process.exit(0);
}

// ── JSONC helpers ───────────────────────────────────────────────────

/** Strip line and block comments from JSONC so JSON.parse can handle it. */
function stripJsonComments(text) {
	let result = "";
	let i = 0;
	let inString = false;
	let stringChar = "";

	while (i < text.length) {
		// inside a JSON string — pass through, handling escapes
		if (inString) {
			if (text[i] === "\\") {
				result += text[i] + (text[i + 1] ?? "");
				i += 2;
				continue;
			}
			if (text[i] === stringChar) inString = false;
			result += text[i];
			i++;
			continue;
		}

		// string start
		if (text[i] === '"' || text[i] === "'") {
			inString = true;
			stringChar = text[i];
			result += text[i];
			i++;
			continue;
		}

		// line comment
		if (text[i] === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}

		// block comment
		if (text[i] === "/" && text[i + 1] === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2; // skip closing */
			continue;
		}

		result += text[i];
		i++;
	}
	return result;
}

// ── config discovery ────────────────────────────────────────────────

/** Walk up from `start` looking for an OpenCode config file. */
function findUp(start) {
	const candidates = [
		".opencode/opencode.jsonc",
		".opencode/opencode.json",
		"opencode.jsonc",
		"opencode.json",
	];

	let dir = path.resolve(start);
	const root = path.parse(dir).root;

	while (true) {
		for (const c of candidates) {
			const full = path.join(dir, c);
			if (fs.existsSync(full)) return full;
		}
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}
	return null;
}

/** Determine the target config path for install. */
function getTargetPath() {
	if (flagGlobal) {
		const globalDir = path.join(os.homedir(), ".config", "opencode");
		// prefer existing file
		for (const name of ["opencode.jsonc", "opencode.json"]) {
			const p = path.join(globalDir, name);
			if (fs.existsSync(p)) return p;
		}
		return path.join(globalDir, "opencode.json");
	}

	// local: walk up from cwd
	const found = findUp(process.cwd());
	if (found) return found;

	// fallback: create in .opencode/
	return path.join(process.cwd(), ".opencode", "opencode.json");
}

/** Find ALL config files that contain open-mem (for uninstall). */
function findAllConfigsWithPlugin() {
	const configs = [];
	const seen = new Set();

	const candidates = [
		".opencode/opencode.jsonc",
		".opencode/opencode.json",
		"opencode.jsonc",
		"opencode.json",
	];

	const tryAdd = (p) => {
		const resolved = path.resolve(p);
		if (seen.has(resolved)) return;
		seen.add(resolved);
		if (!fs.existsSync(resolved)) return;
		try {
			const config = readConfig(resolved);
			if (config && config.data && findPluginEntry(config.data) !== -1) {
				configs.push(resolved);
			}
		} catch {
			/* skip */
		}
	};

	// Walk up from cwd, checking all candidates at each level
	let dir = path.resolve(process.cwd());
	const root = path.parse(dir).root;
	while (true) {
		for (const c of candidates) tryAdd(path.join(dir, c));
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}

	// Global locations
	const globalDir = path.join(os.homedir(), ".config", "opencode");
	tryAdd(path.join(globalDir, "opencode.jsonc"));
	tryAdd(path.join(globalDir, "opencode.json"));

	return configs;
}

// ── read / write helpers ────────────────────────────────────────────

function readConfig(filePath) {
	if (!fs.existsSync(filePath)) return null;
	const raw = fs.readFileSync(filePath, "utf8");
	try {
		return { raw, data: JSON.parse(stripJsonComments(raw)) };
	} catch {
		return { raw, data: null };
	}
}

/**
 * Write a brand-new minimal config with the plugin entry.
 * Used when no config file exists at all.
 */
function writeNewConfig(filePath) {
	const content = JSON.stringify({ plugin: [PLUGIN_ENTRY] }, null, 2) + "\n";
	if (flagDryRun) {
		info(`Would create ${BOLD}${filePath}${RESET} with:`);
		process.stdout.write(DIM + content + RESET);
		return true;
	}
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
	ok(`Created ${BOLD}${filePath}${RESET}`);
	return true;
}

/**
 * Add the plugin entry to an existing config, preserving JSONC comments.
 * Strategy: regex-based insertion so comments survive.
 */
function addPluginEntry(filePath, raw, data) {
	// already present? (handles any version suffix)
	if (data && findPluginEntry(data) !== -1) {
		ok(`${BOLD}${PKG_NAME}${RESET} already in ${filePath}`);
		return false;
	}

	let updated;

	// case 1: "plugin": [...] exists — append our entry
	const pluginArrayRe = /("plugin"\s*:\s*\[)([\s\S]*?)(\])/;
	const m = raw.match(pluginArrayRe);
	if (m) {
		const inside = m[2].trim();
		if (inside.length === 0) {
			// empty array
			updated = raw.replace(pluginArrayRe, `$1"${PLUGIN_ENTRY}"$3`);
		} else {
			// non-empty — add after last entry
			updated = raw.replace(pluginArrayRe, (_, open, entries, close) => {
				const trimmed = entries.trimEnd();
				const needsComma = trimmed.length > 0 && !trimmed.endsWith(",");
				return `${open}${entries.trimEnd()}${needsComma ? "," : ""} "${PLUGIN_ENTRY}"${close}`;
			});
		}
	} else {
		// case 2: no plugin key — inject after the opening {
		const idx = raw.indexOf("{");
		if (idx === -1) {
			err(`Cannot parse ${filePath} — not a JSON object`);
			return false;
		}
		const before = raw.slice(0, idx + 1);
		const after = raw.slice(idx + 1);
		// detect indent
		const indentMatch = after.match(/\n(\s+)/);
		const indent = indentMatch ? indentMatch[1] : "  ";
		updated = `${before}\n${indent}"plugin": ["${PLUGIN_ENTRY}"],${after}`;
	}

	if (flagDryRun) {
		info(`Would update ${BOLD}${filePath}${RESET}`);
		process.stdout.write(DIM + updated + RESET);
		return true;
	}

	fs.writeFileSync(filePath, updated, "utf8");
	ok(`Added ${BOLD}${PLUGIN_ENTRY}${RESET} to ${filePath}`);
	return true;
}

/** Remove the plugin entry from a config file, preserving JSONC comments. */
function removePluginEntry(filePath, raw) {
	if (!raw.includes(PKG_NAME)) return false;

	// Remove the entry (with or without @latest, quotes, surrounding commas)
	let updated = raw;

	// Pattern: "open-mem" or "open-mem@latest" or "open-mem@<version>" as array element
	// Handle trailing comma, leading comma, or standalone
	// NOTE: no 'g' flag — avoids lastIndex issues with test() + replace()
	const patterns = [
		// entry with trailing comma and optional whitespace
		new RegExp(`\\s*"${PKG_NAME}(?:@[^"]*)?"\\s*,`),
		// entry with leading comma — also trim trailing whitespace after comma removal
		new RegExp(`,\\s*"${PKG_NAME}(?:@[^"]*)?"\\s*`),
		// standalone entry (only element)
		new RegExp(`"${PKG_NAME}(?:@[^"]*)?"`),
	];

	for (const pat of patterns) {
		if (pat.test(updated)) {
			updated = updated.replace(pat, "");
			break;
		}
	}

	if (updated === raw) return false;

	if (flagDryRun) {
		info(`Would update ${BOLD}${filePath}${RESET}`);
		return true;
	}

	fs.writeFileSync(filePath, updated, "utf8");
	ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${filePath}`);
	return true;
}

/** Find plugin entry in parsed config data. */
function findPluginEntry(data) {
	if (!data || !Array.isArray(data.plugin)) return -1;
	return data.plugin.findIndex(
		(e) => typeof e === "string" && (e === PKG_NAME || e.startsWith(PKG_NAME + "@")),
	);
}

// ── node_modules cleanup ────────────────────────────────────────────

function findStaleNodeModules(start) {
	const results = [];
	let dir = path.resolve(start);
	const root = path.parse(dir).root;

	while (true) {
		const candidate = path.join(dir, "node_modules", PKG_NAME);
		if (fs.existsSync(candidate)) results.push(candidate);
		const parent = path.dirname(dir);
		if (parent === dir || dir === root) break;
		dir = parent;
	}
	return results;
}

function cleanupNodeModules() {
	const stale = findStaleNodeModules(process.cwd());
	if (stale.length === 0) return;

	for (const p of stale) {
		if (flagDryRun) {
			info(`Would remove ${BOLD}${p}${RESET}`);
			continue;
		}
		try {
			fs.rmSync(p, { recursive: true, force: true });
			ok(`Removed ${BOLD}${p}${RESET}`);
		} catch (e) {
			warn(`Could not remove ${p}: ${e.message}`);
		}
	}

	// also remove from package.json dependencies if present
	const pkgPath = path.join(process.cwd(), "package.json");
	if (fs.existsSync(pkgPath)) {
		try {
			const raw = fs.readFileSync(pkgPath, "utf8");
			if (raw.includes(`"${PKG_NAME}"`)) {
				const pkg = JSON.parse(raw);
				let changed = false;
				for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
					if (pkg[key] && pkg[key][PKG_NAME]) {
						delete pkg[key][PKG_NAME];
						changed = true;
					}
				}
				if (changed) {
					if (flagDryRun) {
						info(`Would remove ${BOLD}${PKG_NAME}${RESET} from ${pkgPath}`);
					} else {
						fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
						ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${pkgPath}`);
					}
				}
			}
		} catch {
			/* skip */
		}
	}
}

// ── confirmation prompt ─────────────────────────────────────────────

async function confirm(question) {
	if (flagForce) return true;
	if (!isTTY) return true; // non-interactive — assume yes

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await rl.question(`${question} ${DIM}[Y/n]${RESET} `);
		return !answer || answer.toLowerCase().startsWith("y");
	} finally {
		rl.close();
	}
}

// ── install flow ────────────────────────────────────────────────────

async function install() {
	const target = getTargetPath();
	info(`Target: ${BOLD}${target}${RESET}`);

	const config = readConfig(target);

	// no file yet — create one
	if (!config) {
		if (!(await confirm(`Create ${target}?`))) {
			info("Aborted.");
			return;
		}
		writeNewConfig(target);
		printNextSteps();
		return;
	}

	// file exists but can't be parsed
	if (!config.data) {
		err(`Could not parse ${target} — fix the JSON/JSONC syntax first.`);
		process.exit(1);
	}

	// already has the entry?
	if (findPluginEntry(config.data) !== -1) {
		ok(`${BOLD}${PLUGIN_ENTRY}${RESET} is already in ${target}`);
		printNextSteps();
		return;
	}

	if (!(await confirm(`Add ${PLUGIN_ENTRY} to ${target}?`))) {
		info("Aborted.");
		return;
	}

	addPluginEntry(target, config.raw, config.data);
	printNextSteps();
}

// ── uninstall flow ──────────────────────────────────────────────────

async function uninstall() {
	const configs = findAllConfigsWithPlugin();

	if (configs.length === 0) {
		info(`No config files found containing ${BOLD}${PKG_NAME}${RESET}.`);
	} else {
		info(`Found ${configs.length} config(s) with ${BOLD}${PKG_NAME}${RESET}:`);
		for (const c of configs) info(`  ${c}`);

		if (await confirm("Remove open-mem from these configs?")) {
			for (const c of configs) {
				const raw = fs.readFileSync(c, "utf8");
				removePluginEntry(c, raw);
			}
		}
	}

	// cleanup node_modules
	const stale = findStaleNodeModules(process.cwd());
	if (stale.length > 0) {
		info(`Found ${stale.length} node_modules installation(s):`);
		for (const s of stale) info(`  ${s}`);

		if (await confirm("Remove these?")) {
			cleanupNodeModules();
		}
	}

	// cleanup OpenCode cache
	const cacheDir = path.join(os.homedir(), ".cache", "opencode", "node_modules", PKG_NAME);
	if (fs.existsSync(cacheDir)) {
		info(`Found cached plugin at ${BOLD}${cacheDir}${RESET}`);
		if (await confirm("Remove cached plugin?")) {
			if (flagDryRun) {
				info(`Would remove ${BOLD}${cacheDir}${RESET}`);
			} else {
				try {
					fs.rmSync(cacheDir, { recursive: true, force: true });
					ok(`Removed ${BOLD}${cacheDir}${RESET}`);
				} catch (e) {
					warn(`Could not remove cache: ${e.message}`);
				}
			}
		}
	}

	// cleanup OpenCode cache package.json dependency
	const cachePkgPath = path.join(os.homedir(), ".cache", "opencode", "package.json");
	if (fs.existsSync(cachePkgPath)) {
		try {
			const raw = fs.readFileSync(cachePkgPath, "utf8");
			if (raw.includes(`"${PKG_NAME}"`)) {
				const pkg = JSON.parse(raw);
				let changed = false;
				for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
					if (pkg[key] && pkg[key][PKG_NAME]) {
						delete pkg[key][PKG_NAME];
						changed = true;
					}
				}
				if (changed) {
					if (flagDryRun) {
						info(`Would remove ${BOLD}${PKG_NAME}${RESET} from ${cachePkgPath}`);
					} else {
						fs.writeFileSync(cachePkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
						ok(`Removed ${BOLD}${PKG_NAME}${RESET} from ${cachePkgPath}`);
					}
				}
			}
		} catch {
			/* skip */
		}
	}

	ok("Uninstall complete.");
}

// ── AI provider detection ───────────────────────────────────────────

function detectAIProviders() {
	const providers = [
		{ key: "GOOGLE_GENERATIVE_AI_API_KEY", name: "Google Gemini" },
		{ key: "ANTHROPIC_API_KEY", name: "Anthropic" },
		{ key: "AWS_ACCESS_KEY_ID", name: "AWS Bedrock" },
		{ key: "OPENAI_API_KEY", name: "OpenAI" },
		{ key: "OPENROUTER_API_KEY", name: "OpenRouter" },
		{ key: "ZHIPU_API_KEY", name: "Zhipu (智谱)" },
	];
	return providers.filter((p) => process.env[p.key]);
}

// ── next steps ──────────────────────────────────────────────────────

function printNextSteps() {
	const detected = detectAIProviders();

	process.stdout.write(`
${GREEN}✓${RESET} ${BOLD}open-mem${RESET} is configured!

${BOLD}Next steps:${RESET}
  1. Start OpenCode — open-mem loads automatically
  2. Use ${BOLD}mem-find${RESET}, ${BOLD}mem-create${RESET}, ${BOLD}mem-history${RESET} tools in your sessions
  3. Observations are captured and compressed automatically

`);

	if (detected.length > 0) {
		const names = detected.map((p) => p.name).join(", ");
		process.stdout.write(`${BOLD}AI compression:${RESET} ${GREEN}✓${RESET} ${names} detected\n`);
	} else {
		process.stdout.write(
			`${BOLD}Optional — enable AI compression:${RESET}\n` +
				`  ${DIM}export GOOGLE_GENERATIVE_AI_API_KEY=...${RESET}\n` +
				`  ${DIM}# Also supports: Anthropic, AWS Bedrock, OpenAI, OpenRouter, Zhipu (智谱)${RESET}\n`,
		);
	}

	process.stdout.write(`\n${BOLD}Docs:${RESET} ${DOCS_URL}\n`);
}

// ── wizard flow ────────────────────────────────────────────────────────

async function runWizard() {
	const p = await import("@clack/prompts");

	p.intro("open-mem — setup wizard");

	// Detect if plugin is already installed somewhere
	const existingLocal = findUp(process.cwd());
	const globalDir = path.join(os.homedir(), ".config", "opencode");
	const existingGlobal = ["opencode.jsonc", "opencode.json"]
		.map((n) => path.join(globalDir, n))
		.find((p) => fs.existsSync(p));

	let alreadyInstalled = false;
	for (const cfgPath of [existingLocal, existingGlobal].filter(Boolean)) {
		const cfg = readConfig(cfgPath);
		if (cfg && cfg.data && findPluginEntry(cfg.data) !== -1) {
			alreadyInstalled = true;
			p.log.info(`Plugin already configured in ${cfgPath} — reconfiguring settings.`);
			break;
		}
	}

	const answers = await p.group({
		scope: () => p.select({
			message: "Where to install?",
			options: [
				{ value: "local", label: "This project", hint: ".opencode/opencode.json" },
				{ value: "global", label: "Global", hint: "~/.config/opencode/opencode.json" },
			],
		}),

		provider: () => p.select({
			message: "AI compression provider",
			options: [
				{ value: "auto", label: "Auto-detect", hint: "uses your environment keys, or OpenCode's model as fallback — recommended" },
				{ value: "google", label: "Google Gemini", hint: "free tier available" },
				{ value: "anthropic", label: "Anthropic", hint: "Claude models" },
				{ value: "bedrock", label: "AWS Bedrock", hint: "uses AWS credentials" },
				{ value: "openai", label: "OpenAI", hint: "GPT models" },
				{ value: "openrouter", label: "OpenRouter", hint: "100+ models" },
				{ value: "zhipu", label: "Zhipu (智谱)", hint: "free tier with glm-4.7-flash" },
				{ value: "none", label: "None", hint: "basic metadata only, no AI key needed" },
			],
		}),

		dashboard: () => p.confirm({
			message: "Enable web dashboard?",
			initialValue: false,
		}),

		mode: () => p.select({
			message: "Workflow mode",
			options: [
				{ value: "code", label: "Code", hint: "optimized for coding sessions — default" },
				{ value: "research", label: "Research", hint: "broader knowledge capture" },
			],
		}),

		folderContext: () => p.select({
			message: "Auto-generate context files per folder?",
			options: [
				{ value: "AGENTS.md", label: "AGENTS.md", hint: "OpenCode default" },
				{ value: "CLAUDE.md", label: "CLAUDE.md", hint: "for Claude Code users" },
				{ value: "disabled", label: "Disabled", hint: "no auto-generated files" },
			],
		}),
	}, {
		onCancel: () => {
			p.cancel("Setup cancelled.");
			process.exit(0);
		},
	});

	// Apply the configuration
	const s = p.spinner();

	// 1. Add plugin to opencode config (unless already installed)
	if (!alreadyInstalled) {
		s.start("Adding open-mem to OpenCode config");
		const isGlobal = answers.scope === "global";

		// Determine target path based on wizard scope answer
		let target;
		if (isGlobal) {
			const gDir = path.join(os.homedir(), ".config", "opencode");
			target = ["opencode.jsonc", "opencode.json"]
				.map((n) => path.join(gDir, n))
				.find((p) => fs.existsSync(p)) || path.join(gDir, "opencode.json");
		} else {
			const found = findUp(process.cwd());
			target = found || path.join(process.cwd(), ".opencode", "opencode.json");
		}

		const config = readConfig(target);
		if (!config) {
			writeNewConfig(target);
		} else if (config.data) {
			addPluginEntry(target, config.raw, config.data);
		} else {
			p.log.error(`Could not parse ${target} — fix the JSON/JSONC syntax first.`);
			process.exit(1);
		}
		s.stop("Plugin configured");
	}

	// 2. Write .open-mem/config.json (only if non-default choices)
	const projectConfig = {};
	if (answers.provider !== "auto" && answers.provider !== "none" && answers.provider !== "google") {
		projectConfig.provider = answers.provider;
	}
	if (answers.dashboard) {
		projectConfig.dashboardEnabled = true;
	}
	if (answers.mode !== "code") {
		projectConfig.mode = answers.mode;
	}
	if (answers.folderContext === "disabled") {
		projectConfig.folderContextEnabled = false;
	} else if (answers.folderContext === "CLAUDE.md") {
		projectConfig.folderContextFilename = "CLAUDE.md";
	}

	if (Object.keys(projectConfig).length > 0) {
		s.start("Writing project config");
		const configDir = path.join(process.cwd(), ".open-mem");
		const configPath = path.join(configDir, "config.json");

		// Read existing config if present, merge
		let existing = {};
		if (fs.existsSync(configPath)) {
			try { existing = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch {}
		}

		const merged = { ...existing, ...projectConfig };

		if (flagDryRun) {
			s.stop("Project config (dry-run)");
			p.log.info(`Would write to ${configPath}:`);
			p.log.message(JSON.stringify(merged, null, 2));
		} else {
			fs.mkdirSync(configDir, { recursive: true });
			fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
			s.stop("Project config saved");
		}
	}

	// 3. Show summary
	const providerLabels = {
		auto: "Auto-detect",
		google: "Google Gemini",
		anthropic: "Anthropic",
		bedrock: "AWS Bedrock",
		openai: "OpenAI",
		openrouter: "OpenRouter",
		zhipu: "Zhipu (智谱)",
		none: "None (basic extractor)",
	};

	const summaryLines = [
		`Provider:    ${providerLabels[answers.provider]}`,
		`Dashboard:   ${answers.dashboard ? "enabled" : "disabled"}`,
		`Mode:        ${answers.mode}`,
		`Context:     ${answers.folderContext === "disabled" ? "disabled" : answers.folderContext}`,
	];
	p.note(summaryLines.join("\n"), "Configuration");
	if (answers.provider === "auto") {
		const detected = detectAIProviders();
		if (detected.length > 0) {
			const names = detected.map((d) => d.name).join(", ");
			p.log.info(`AI compression: ${names} detected \u2014 will use directly`);
		} else {
			p.log.info("AI compression: will use your OpenCode session model automatically");
			p.log.message("  No separate API key needed \u2014 open-mem piggybacks on your active provider.");
			p.log.message("  Optional: set GOOGLE_GENERATIVE_AI_API_KEY for a dedicated (free) compression model.");
		}
	}

	// 4. Show env var instructions for chosen provider
	const envVarInstructions = {
		auto: null,
		google: "export GOOGLE_GENERATIVE_AI_API_KEY=...  # free key: https://aistudio.google.com/apikey",
		anthropic: "export ANTHROPIC_API_KEY=sk-ant-...",
		bedrock: "# Configure AWS credentials (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY or AWS_PROFILE)",
		openai: "export OPENAI_API_KEY=sk-...",
		openrouter: "export OPENROUTER_API_KEY=sk-or-...",
		zhipu: "export ZHIPU_API_KEY=...  # free key: https://open.bigmodel.cn/",
		none: null,
	};

	if (envVarInstructions[answers.provider]) {
		p.note(envVarInstructions[answers.provider], "Set this environment variable");
	}

	if (answers.dashboard) {
		p.log.info("Dashboard will be available at http://localhost:3737");
	}

	p.outro("open-mem is ready! Start OpenCode to begin.");
}

// ── main ────────────────────────────────────────────────────────────

function printHeader(version) {
	process.stdout.write(
		`\n${BOLD}open-mem${RESET}${version ? ` ${DIM}v${version}${RESET}` : ""} ${DIM}— Persistent memory plugin for OpenCode${RESET}\n\n`,
	);
}
async function main() {
	const version = getVersion();
	// Flags that bypass the wizard entirely
	if (flagUninstall) {
		printHeader(version);
		if (flagDryRun) info(`${YELLOW}Dry-run mode${RESET} — no files will be modified.\n`);
		await uninstall();
		return;
	}

	// Interactive wizard: default when TTY and no bypass flags
	const useWizard = process.stdout.isTTY && process.stdin.isTTY && !flagQuick && !flagForce && !flagGlobal;

	if (useWizard) {
		try {
			await runWizard();
		} catch (e) {
			// If clack fails to load or crashes, fall back to quick install
			warn(`Wizard failed (${e.message}), falling back to quick install.`);
			printHeader(version);
			if (flagDryRun) info(`${YELLOW}Dry-run mode${RESET} — no files will be modified.\n`);
			await install();
		}
	} else {
		// Quick install (existing behavior)
		printHeader(version);
		if (flagDryRun) info(`${YELLOW}Dry-run mode${RESET} — no files will be modified.\n`);
		await install();
	}
}

main().catch((e) => {
	err(e.message);
	process.exit(1);
});
