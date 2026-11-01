import { describe, expect, it } from "vitest";
import { createDisabledBrowserVoiceSession, endBrowserVoiceSession } from "@/lib/livekit-browser-session";

describe("disabled browser LiveKit session seam", () => {
  it("does not create a room or request media", () => {
    const session = createDisabledBrowserVoiceSession();
    expect(session.state).toBe("unavailable");
    expect(session).not.toHaveProperty("room");
  });

  it("ends only the local preparation state", () => {
    expect(endBrowserVoiceSession({ state: "ready", reason: "test" })).toEqual({
      state: "ended",
      room: undefined,
      reason: "Session ended",
    });
  });
});
