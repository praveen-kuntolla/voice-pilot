"use client";

import Link from "next/link";

export function VoiceSandboxPreparation() {
  return <section className="card" aria-labelledby="voice-sandbox-preparation" style={{ marginTop: 18 }}>
    <div className="eyebrow">Future voice sandbox</div>
    <h2 id="voice-sandbox-preparation">Test Voice Agent</h2>
    <p className="muted">Real-time browser voice is not available yet. Microphone capture, LiveKit rooms, audio generation and provider activation remain disabled.</p>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <button className="btn primary" type="button" disabled aria-disabled="true">Test Voice Agent</button>
      <span className="badge">Provider disabled</span>
      <Link className="btn ghost" href="/dashboard/agents/test">Open text-only test studio</Link>
    </div>
    <ul className="muted" style={{ marginTop: 12 }}>
      <li>Session state: unavailable</li>
      <li>Usage limit: not reserved</li>
      <li>Recording: disabled by default</li>
    </ul>
    <p className="muted" style={{ marginBottom: 0 }}>Future admission will require tenant authorization, signed gateway approval, explicit microphone consent, bounded duration, emergency-stop clearance and durable usage capacity.</p>
  </section>;
}
