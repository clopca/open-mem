import { createDatabase } from "../../src/db/database";
import { ObservationRepository } from "../../src/db/observations";
import { initializeSchema } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/sessions";
import { SummaryRepository } from "../../src/db/summaries";
import { McpServer } from "../../src/servers/mcp-server";

const dbPath = process.argv[2] || ":memory:";
const db = createDatabase(dbPath);
initializeSchema(db);

const server = new McpServer({
	observations: new ObservationRepository(db),
	sessions: new SessionRepository(db),
	summaries: new SummaryRepository(db),
	projectPath: "/tmp/proj",
	version: "1.0.0-test",
});

server.start();
