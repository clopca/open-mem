import { createDatabase } from "../../src/db/database";
import { DefaultMemoryEngine } from "../../src/core/memory-engine";
import { getDefaultConfig } from "../../src/config";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { SearchOrchestrator } from "../../src/search/orchestrator";
import { McpServer } from "../../src/adapters/mcp/server";
import {
	createObservationStore,
	createSessionStore,
	createSummaryStore,
} from "../../src/store/sqlite/adapters";

const dbPath = process.argv[2] || ":memory:";
const db = createDatabase(dbPath);
initializeSchema(db);

const config = getDefaultConfig();

const observations = new ObservationRepository(db);
const sessions = new SessionRepository(db);
const summaries = new SummaryRepository(db);
const searchOrchestrator = new SearchOrchestrator(observations, null, false, null, null, null);

const server = new McpServer({
	memoryEngine: new DefaultMemoryEngine({
		observations: createObservationStore(observations),
		sessions: createSessionStore(sessions),
		summaries: createSummaryStore(summaries),
		searchOrchestrator,
		projectPath: "/tmp/proj",
		config,
		userObservationRepo: null,
	}),
	version: "0.7.0-test",
});

server.start();
