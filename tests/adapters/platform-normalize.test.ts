import { describe, expect, test } from "bun:test";
import { normalizeExternalEvent, normalizeOpenCodeEvent } from "../../src/adapters/platform/normalize";

describe("platform event normalization", () => {
  test("normalizes OpenCode tool execute hook", () => {
    const event = normalizeOpenCodeEvent({
      eventType: "tool.execute.after",
      payload: { sessionID: "s1", callID: "c1", tool: "Read" },
      output: { output: "file contents", title: "Read file" },
    });

    expect(event).not.toBeNull();
    expect(event?.kind).toBe("tool.execute");
    expect(event?.platform).toBe("opencode");
  });

  test("normalizes OpenCode session idle event", () => {
    const event = normalizeOpenCodeEvent({
      eventType: "event",
      payload: {
        event: {
          type: "session.idle",
          properties: { sessionID: "s1" },
        },
      },
    });

    expect(event).not.toBeNull();
    expect(event?.kind).toBe("idle.flush");
  });

  test("normalizes Claude Code external event", () => {
    const event = normalizeExternalEvent("claude-code", {
      kind: "chat.message",
      sessionId: "s1",
      text: "hello",
      role: "user",
    });

    expect(event).not.toBeNull();
    expect(event?.platform).toBe("claude-code");
    expect(event?.kind).toBe("chat.message");
  });

  test("rejects invalid payloads", () => {
    const event = normalizeExternalEvent("cursor", { kind: "tool.execute", sessionId: "s1" });
    expect(event).toBeNull();
  });
});
