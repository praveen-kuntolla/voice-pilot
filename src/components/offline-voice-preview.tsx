"use client";

import { useState } from "react";
import { buildOfflineVoicePreview, OFFLINE_VOICE_PROFILES, type OfflineVoicePreview as Preview } from "@/lib/voice-profiles";

type OfflineVoicePreviewProps = { agentLanguage?: string | null; agentVoice?: string | null };

export function OfflineVoicePreview({ agentLanguage = "en-US", agentVoice }: OfflineVoicePreviewProps) {
  const [profileId, setProfileId] = useState(OFFLINE_VOICE_PROFILES[0].id);
  const [sample, setSample] = useState("Hello, this is a simulated voice preview.");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const selected = OFFLINE_VOICE_PROFILES.find((profile) => profile.id === profileId);

  function previewVoice() {
    const result = buildOfflineVoicePreview(profileId, sample, agentLanguage || "en-US");
    if (!result.ok) { setPreview(null); setError(result.error); return; }
    setPreview(result.value);
    setError("");
  }

  return <section className="card" aria-labelledby="offline-voice-preview-title" style={{ marginTop: 18 }}>
    <div className="eyebrow">Offline voice foundation</div>
    <h3 id="offline-voice-preview-title">Simulated voice profile preview</h3>
    <p className="muted">SIMULATION ONLY — this preview renders text metadata and never creates audio or contacts a provider.</p>
    <label className="muted" htmlFor="offline-voice-profile">Voice profile</label>
    <select id="offline-voice-profile" className="input" value={profileId} onChange={(event) => { setProfileId(event.target.value); setPreview(null); setError(""); }}>
      {OFFLINE_VOICE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.language}</option>)}
    </select>
    {selected && <p className="muted">{selected.style} · {selected.description}{agentVoice ? ` Configured agent voice: ${agentVoice}.` : ""}</p>}
    <label className="muted" htmlFor="offline-voice-sample">Preview text</label>
    <textarea id="offline-voice-sample" className="input" value={sample} maxLength={240} onChange={(event) => { setSample(event.target.value); setPreview(null); }} style={{ minHeight: 76 }} />
    <button className="btn ghost" type="button" onClick={previewVoice}>Preview profile text</button>
    {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
    {preview && <div className="notice" role="status" style={{ marginTop: 10 }}><strong>{preview.label}</strong><p className="muted">{preview.profileName} · {preview.language}</p><p>{preview.sample}</p><p className="muted">No audio was generated.</p></div>}
  </section>;
}
