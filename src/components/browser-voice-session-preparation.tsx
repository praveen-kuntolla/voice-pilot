"use client";

import { useState } from "react";

export function BrowserVoiceSessionPreparation() {
  const [status, setStatus] = useState<"unavailable" | "ended">("unavailable");
  return <section className="card" aria-labelledby="browser-voice-session" style={{ marginTop: 18 }}>
    <div className="eyebrow">Browser voice session · SIMULATION ONLY</div>
    <h2 id="browser-voice-session">Real-time voice preparation</h2>
    <p className="muted">LiveKit transport, microphone capture, audio generation and provider requests are disabled until independent security approval.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn primary" type="button" disabled aria-disabled="true" onClick={() => setStatus("unavailable")}>Start voice session</button>
      <button className="btn ghost" type="button" disabled={status === "unavailable"} onClick={() => setStatus("ended")}>End session</button>
      <span className="badge">Provider activation disabled</span>
    </div>
    <p className="muted" role="status" aria-live="polite" style={{ marginBottom: 0 }}>Status: {status === "unavailable" ? "Unavailable — no microphone permission requested" : "Ended"}</p>
  </section>;
}
