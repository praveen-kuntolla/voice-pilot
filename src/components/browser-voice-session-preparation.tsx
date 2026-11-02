"use client";

import { useState } from "react";
import { createDisabledBrowserVoiceSession, endBrowserVoiceSession } from "@/lib/livekit-browser-session";

export function BrowserVoiceSessionPreparation() {
  const [session, setSession] = useState(createDisabledBrowserVoiceSession);
  return <section className="card" aria-labelledby="browser-voice-session" style={{ marginTop: 18 }}>
    <div className="eyebrow">Browser voice session · SIMULATION ONLY</div>
    <h2 id="browser-voice-session">Real-time voice preparation</h2>
    <p className="muted">LiveKit transport, microphone capture, audio generation and provider requests are disabled until independent security approval.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn primary" type="button" disabled aria-disabled="true">Start voice session</button>
      <button className="btn ghost" type="button" disabled={session.state === "unavailable"} onClick={() => setSession(endBrowserVoiceSession(session))}>End session</button>
      <span className="badge">Provider activation disabled</span>
    </div>
    <p className="muted" role="status" aria-live="polite" style={{ marginBottom: 0 }}>Status: {session.state === "unavailable" ? "Unavailable — no microphone permission requested" : "Ended"}</p>
  </section>;
}
