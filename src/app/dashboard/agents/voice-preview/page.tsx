import Link from "next/link";
import { OfflineVoicePreview } from "@/components/offline-voice-preview";

export default function VoicePreviewPage() {
  return <main className="main container">
    <Link className="muted" href="/dashboard/agents">← Back to agents</Link>
    <div className="section" style={{ paddingTop: 40, maxWidth: 760 }}>
      <div className="eyebrow">Phase 8 foundation · offline only</div>
      <h1>Voice profile lab</h1>
      <p className="muted">Compare deterministic synthetic voice profiles before any provider is configured. This page never generates audio, stores samples, or makes network requests.</p>
      <OfflineVoicePreview />
    </div>
  </main>;
}
