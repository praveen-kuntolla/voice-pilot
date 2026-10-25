import { describe, expect, it } from "vitest";
import { LocalConversationController, runtimeConfigSchema } from "@/lib/voice-runtime";

const config = runtimeConfigSchema.parse({ organizationId: "00000000-0000-4000-8000-000000000001", agentId: "00000000-0000-4000-8000-000000000002", language: "en", instructions: "Be helpful." });

describe("mock voice session contracts", () => {
  it("supports deterministic turns, interruption and clean ending", async () => {
    const session = new LocalConversationController(config); expect(session.state).toBe("idle");
    await session.runSimulatedTurn("Hello"); expect(session.state).toBe("idle"); expect(session.events.some((event) => event.kind === "final_transcript")).toBe(true);
    expect(session.interrupt()).toBe(false); session.end(); expect(session.state).toBe("ended"); await expect(session.runSimulatedTurn("again")).rejects.toThrow("ended");
  });
  it("rejects invalid runtime configuration", () => { expect(() => runtimeConfigSchema.parse({ organizationId: "bad" })).toThrow(); });
});
