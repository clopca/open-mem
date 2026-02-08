#!/usr/bin/env bun
import { createDatabase } from "../src/db/database";
import { ObservationRepository } from "../src/db/observations";
import { SessionRepository } from "../src/db/sessions";
import { SummaryRepository } from "../src/db/summaries";
import { initializeSchema } from "../src/db/schema";
import { SearchOrchestrator } from "../src/search/orchestrator";

const db = createDatabase(":memory:");
initializeSchema(db, { hasVectorExtension: false, embeddingDimension: 0 });

const observations = new ObservationRepository(db);
const sessions = new SessionRepository(db);
new SummaryRepository(db);

const projectPath = "/tmp/bench";
sessions.create("bench-session", projectPath);

for (let i = 0; i < 2000; i++) {
  observations.create({
    sessionId: "bench-session",
    type: i % 2 === 0 ? "feature" : "discovery",
    title: `Observation ${i}`,
    subtitle: "",
    facts: ["benchmark", "search", `item-${i}`],
    narrative: `This is benchmark narrative ${i} about sqlite fts and ranking quality.`,
    concepts: ["benchmark", i % 3 === 0 ? "fts" : "semantic"],
    filesRead: ["src/index.ts"],
    filesModified: ["src/search/orchestrator.ts"],
    rawToolOutput: "",
    toolName: "benchmark",
    tokenCount: 20,
    discoveryTokens: 60,
  });
}

const orchestrator = new SearchOrchestrator(observations, null, false, null, null, null);

const queries = ["sqlite ranking", "semantic search", "orchestrator", "benchmark item-42"];
const timings: number[] = [];

for (const query of queries) {
  const start = performance.now();
  await orchestrator.search(query, { projectPath, limit: 20 });
  timings.push(performance.now() - start);
}

const avg = timings.reduce((sum, n) => sum + n, 0) / timings.length;
const p95 = timings.slice().sort((a, b) => a - b)[Math.floor(timings.length * 0.95)] ?? 0;

console.log("open-mem search benchmark");
console.log(JSON.stringify({ queries: queries.length, avgMs: Number(avg.toFixed(2)), p95Ms: Number(p95.toFixed(2)) }, null, 2));

db.close();
