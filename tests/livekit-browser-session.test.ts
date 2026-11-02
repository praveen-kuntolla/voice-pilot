import { describe, expect, it } from "vitest";
import { createDisabledBrowserVoiceSession, endBrowserVoiceSession, LiveKitBrowserVoiceSession } from "@/lib/livekit-browser-session";

function fakeRoom() {
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  return {
    remoteParticipants: new Map(),
    localParticipant: { setMicrophoneEnabled: async () => undefined },
    connect: async () => undefined,
    disconnect: async () => undefined,
    on(event: string, handler: (...args: never[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)?.add(handler); },
    off(event: string, handler: (...args: never[]) => void) { listeners.get(event)?.delete(handler); },
  };
}

describe("disabled browser LiveKit session seam", () => {
  it("does not create a room or request media", () => {
    const session = createDisabledBrowserVoiceSession();
    expect(session.state).toBe("unavailable");
    expect(session).not.toHaveProperty("room");
  });

  it("ends only the local preparation state", () => {
    expect(endBrowserVoiceSession({ state: "idle", participantCount: 0, activeSpeakerCount: 0, microphoneEnabled: false, error: "test" })).toEqual({
      state: "ended",
      participantCount: 0,
      activeSpeakerCount: 0,
      microphoneEnabled: false,
      error: undefined,
    });
  });

  it("does not connect when activation is disabled", async () => {
    const session = new LiveKitBrowserVoiceSession({ roomFactory: fakeRoom, enabled: false });
    await expect(session.connect({ url: "wss://example.invalid", token: "fake-token", room: "room", sessionId: "session" })).rejects.toThrow(/disabled/);
    expect(session.getSnapshot().state).toBe("unavailable");
    await session.dispose();
  });

  it("supports lifecycle orchestration with an injected fake room", async () => {
    const session = new LiveKitBrowserVoiceSession({ roomFactory: fakeRoom, enabled: true });
    await session.connect({ url: "wss://example.invalid", token: "fake-token", room: "room", sessionId: "session" });
    await session.setMicrophoneEnabled(false);
    await session.disconnect();
    expect(session.getSnapshot().state).toBe("ended");
    await session.dispose();
  });

  it("rejects microphone access before an authorized connected session", async () => {
    const session = new LiveKitBrowserVoiceSession({ roomFactory: fakeRoom, enabled: true });
    await expect(session.setMicrophoneEnabled(true)).rejects.toThrow(/authorized connected/);
    await session.dispose();
  });

  it("serializes connect and disconnect and cleans up failed connects", async () => {
    let disconnected = 0;
    const room = { ...fakeRoom(), connect: async () => { throw new Error("offline"); }, disconnect: async () => { disconnected += 1; } };
    const session = new LiveKitBrowserVoiceSession({ roomFactory: () => room, enabled: true });
    await expect(session.connect({ url: "wss://example.invalid", token: "fake-token", room: "room", sessionId: "session" })).rejects.toThrow("offline");
    await session.disconnect();
    expect(disconnected).toBe(2);
    expect(session.getSnapshot().state).toBe("ended");
    await session.dispose();
  });
});
