import type { Room } from "livekit-client";

export type BrowserVoiceSessionState = "unavailable" | "ready" | "ended";

export type BrowserVoiceSession = {
  state: BrowserVoiceSessionState;
  room?: Room;
  reason: string;
};

/**
 * Browser-side seam for the LiveKit React experience.
 *
 * This intentionally does not construct a Room, request a token, or ask for
 * microphone permission. A future approved implementation can replace this
 * seam with LiveKit's RoomContext/RoomAudioRenderer controls without changing
 * the authenticated OUTLIVO screen.
 */
export function createDisabledBrowserVoiceSession(): BrowserVoiceSession {
  return {
    state: "unavailable",
    reason: "LiveKit, microphone capture, and providers are disabled",
  };
}

export function endBrowserVoiceSession(session: BrowserVoiceSession): BrowserVoiceSession {
  return { ...session, state: "ended", room: undefined, reason: "Session ended" };
}
