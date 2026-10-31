"use client";

import { useEffect, useRef, useState } from "react";
import { AudioLines, RotateCcw } from "lucide-react";
import {
  MOCK_SPEAKING_RATE_HINTS,
  MOCK_STYLE_NOTE_CHARACTERS,
  OFFLINE_VOICE_PROFILES,
  buildMockVoiceConfig,
  buildOfflineVoicePreview,
  type MockSpeakingRateHint,
  type MockVoiceConfig,
  type OfflineVoicePreview,
} from "@/lib/voice-profiles";

export type MockVoiceConfiguratorProps = {
  /** The agent language the ephemeral configuration must stay compatible with. */
  agentLanguage?: string | null;
  /** Changes whenever the surrounding agent context changes (edit target, new agent). */
  contextKey: string;
  /** Reports the latest validated ephemeral configuration, or null when cleared. */
  onConfigChange?: (config: MockVoiceConfig | null) => void;
};

const defaultSample = "Hello, this is a simulated voice preview.";

/**
 * Reusable simulation-only mock voice configurator. All state is ephemeral React
 * state: nothing is persisted, uploaded, sent to a provider, or played as audio.
 */
export function MockVoiceConfigurator({ agentLanguage = "en-US", contextKey, onConfigChange }: MockVoiceConfiguratorProps) {
  const [profileId, setProfileId] = useState(OFFLINE_VOICE_PROFILES[0].id);
  const [speakingRateHint, setSpeakingRateHint] = useState<MockSpeakingRateHint>("normal");
  const [styleNote, setStyleNote] = useState("");
  const [sample, setSample] = useState(defaultSample);
  const [config, setConfig] = useState<MockVoiceConfig | null>(null);
  const [preview, setPreview] = useState<OfflineVoicePreview | null>(null);
  const [error, setError] = useState("");
  const reportedRef = useRef<MockVoiceConfig | null>(null);

  function report(next: MockVoiceConfig | null) {
    reportedRef.current = next;
    onConfigChange?.(next);
  }

  function reset(reason?: string) {
    setProfileId(OFFLINE_VOICE_PROFILES[0].id);
    setSpeakingRateHint("normal");
    setStyleNote("");
    setSample(defaultSample);
    setConfig(null);
    setPreview(null);
    setError(reason ?? "");
    report(null);
  }

  // Context switches (agent edit target, new-agent form, language change) reset
  // the entire ephemeral configuration; a stale callback can never restore it.
  useEffect(() => {
    reportedRef.current = null;
    onConfigChange?.(null);
    setProfileId(OFFLINE_VOICE_PROFILES[0].id);
    setSpeakingRateHint("normal");
    setStyleNote("");
    setSample(defaultSample);
    setConfig(null);
    setPreview(null);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, agentLanguage]);

  useEffect(() => () => onConfigChange?.(null), [onConfigChange]);

  function validateCurrent(): MockVoiceConfig | null {
    const result = buildMockVoiceConfig({ profileId, agentLanguage: agentLanguage || "en-US", speakingRateHint, styleNote });
    if (!result.ok) {
      setConfig(null);
      setError(result.error);
      report(null);
      return null;
    }
    return result.value;
  }

  function applyConfiguration() {
    const value = validateCurrent();
    if (!value) return;
    setConfig(value);
    setError("");
    report(value);
  }

  function previewConfiguration() {
    const value = validateCurrent();
    if (!value) return;
    const previewResult = buildOfflineVoicePreview(value.profileId, sample, value.agentLanguage);
    if (!previewResult.ok) {
      setPreview(null);
      setError(previewResult.error);
      return;
    }
    setPreview(previewResult.value);
    setError("");
  }

  const selected = OFFLINE_VOICE_PROFILES.find((profile) => profile.id === profileId);
  const languageCompatible = selected ? selected.language.split("-")[0] === (agentLanguage || "en-US").split("-")[0] : false;

  return <section className="card" aria-labelledby="mock-voice-configurator-title" style={{ marginTop: 18 }}>
    <div className="eyebrow">Simulation only · browser memory</div>
    <h3 id="mock-voice-configurator-title">Mock voice configuration</h3>
    <p className="muted">SIMULATION ONLY — this configuration labels local simulated sessions. It never plays audio, saves to the agent, or contacts a provider.</p>
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 12 }}>
      <div>
        <label className="muted" htmlFor="mock-voice-profile">Mock voice profile</label>
        <select id="mock-voice-profile" className="input" value={profileId} onChange={(event) => { setProfileId(event.target.value); setConfig(null); setPreview(null); setError(""); report(null); }}>
          {OFFLINE_VOICE_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.language}</option>)}
        </select>
        {selected && <p className="muted" role="status">{languageCompatible ? `Compatible with agent language ${agentLanguage || "en-US"}.` : `Not compatible with agent language ${agentLanguage || "en-US"}.`} {selected.style} · {selected.description}</p>}
        <label className="muted" htmlFor="mock-voice-rate" style={{ display: "block", marginTop: 10 }}>Speaking-rate hint</label>
        <select id="mock-voice-rate" className="input" value={speakingRateHint} onChange={(event) => { setSpeakingRateHint(event.target.value as MockSpeakingRateHint); setConfig(null); setError(""); report(null); }}>
          {MOCK_SPEAKING_RATE_HINTS.map((hint) => <option key={hint} value={hint}>{hint}</option>)}
        </select>
        <label className="muted" htmlFor="mock-voice-style-note" style={{ display: "block", marginTop: 10 }}>Style note (optional)</label>
        <input id="mock-voice-style-note" className="input" value={styleNote} maxLength={MOCK_STYLE_NOTE_CHARACTERS + 1} placeholder="Optional simulated delivery note" onChange={(event) => { setStyleNote(event.target.value); setConfig(null); setError(""); report(null); }} />
      </div>
      <div>
        <label className="muted" htmlFor="mock-voice-sample">Preview text</label>
        <textarea id="mock-voice-sample" className="input" value={sample} maxLength={260} onChange={(event) => { setSample(event.target.value); setPreview(null); }} style={{ minHeight: 90 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button className="btn primary" type="button" onClick={applyConfiguration}>Apply configuration</button>
          <button className="btn ghost" type="button" onClick={previewConfiguration}><AudioLines size={16} /> Preview profile text</button>
          <button className="btn ghost" type="button" onClick={() => reset()}><RotateCcw size={16} /> Reset configuration</button>
        </div>
        {error && <p role="alert" style={{ color: "#fca5a5", marginTop: 10 }}>{error}</p>}
        {config && <div className="notice" style={{ marginTop: 10 }}>
          <strong>{config.profileName}</strong> · {config.language} · rate hint: {config.speakingRateHint}
          {config.styleNote && <p className="muted">Style note: {config.styleNote}</p>}
          <p className="muted">Ephemeral mock configuration for local simulations only — not saved to the agent.</p>
        </div>}
        {preview && <div className="notice" style={{ marginTop: 10 }}>
          <strong>SIMULATION ONLY — text preview</strong>
          <p className="muted">{preview.profileName} ({preview.language}): “{preview.sample}”</p>
          <p className="muted">No audio is rendered and no provider is contacted.</p>
        </div>}
      </div>
    </div>
  </section>;
}
