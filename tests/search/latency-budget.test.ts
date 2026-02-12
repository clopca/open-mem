import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createDatabase, Database } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";

const P95_SEARCH_BUDGET_MS = 250;

function makeDb() {
	const dbPath = `/tmp/open-mem-latency-${randomUUID()}.db`;
	const db = createDatabase(dbPath);
	initializeSchema(db, {
		hasVectorExtension: Database.enableExtensionSupport(),
		embeddingDimension: 128,
	});
	return { db, dbPath };
}

describe("search latency budget", () => {
	test("FTS search p95 under budget on fixture dataset", () => {
		const { db, dbPath } = makeDb();
		try {
			const sessions = new SessionRepository(db);
			const observations = new ObservationRepository(db);
			sessions.create("latency-session", "/tmp/latency");

			for (let i = 0; i < 400; i++) {
				observations.create({
					sessionId: "latency-session",
					type: i % 2 === 0 ? "feature" : "discovery",
					title: `Latency fixture ${i}`,
					subtitle: "",
					facts: [`fact-${i}`],
					narrative: `Searchable narrative ${i} about indexing and retrieval`,
					concepts: ["latency", "search", `${i}`],
					filesRead: ["src/index.ts"],
					filesModified: [],
					rawToolOutput: "",
					toolName: "mem-create",
					tokenCount: 30,
					discoveryTokens: 30,
				});
			}

			const samples: number[] = [];
			for (let i = 0; i < 40; i++) {
				const start = performance.now();
				observations.search({
					query: "indexing retrieval",
					projectPath: "/tmp/latency",
					limit: 20,
				});
				samples.push(performance.now() - start);
			}

			samples.sort((a, b) => a - b);
			const p95 = samples[Math.floor(samples.length * 0.95) - 1] ?? samples[samples.length - 1];
			expect(p95).toBeLessThan(P95_SEARCH_BUDGET_MS);
		} finally {
			db.close();
			for (const suffix of ["", "-wal", "-shm"]) {
				try {
					unlinkSync(`${dbPath}${suffix}`);
				} catch {}
			}
		}
	});
});
