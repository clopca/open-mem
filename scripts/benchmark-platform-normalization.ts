#!/usr/bin/env bun
import { normalizeExternalEvent, normalizeOpenCodeEvent } from "../src/adapters/platform/normalize";

const count = 10000;
const start = performance.now();

for (let i = 0; i < count; i++) {
  normalizeOpenCodeEvent({
    eventType: "tool.execute.after",
    payload: { sessionID: `s-${i}`, callID: `c-${i}`, tool: "Read" },
    output: { output: "content", title: "Read" },
  });
  normalizeExternalEvent("cursor", {
    kind: "chat.message",
    sessionId: `s-${i}`,
    text: `message-${i}`,
    role: "user",
  });
}

const elapsed = performance.now() - start;
console.log("platform normalization benchmark");
console.log(JSON.stringify({ events: count * 2, totalMs: Number(elapsed.toFixed(2)), avgUs: Number(((elapsed * 1000) / (count * 2)).toFixed(2)) }, null, 2));
