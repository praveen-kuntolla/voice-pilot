"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

type Provider = "deepgram" | "openai" | "elevenlabs";
type Approval = { provider: Provider; revoked_at?: string | null };

const providers: Array<{ id: Provider; label: string }> = [
  { id: "deepgram", label: "Deepgram · STT" },
  { id: "openai", label: "OpenAI · LLM" },
  { id: "elevenlabs", label: "ElevenLabs · TTS" },
];

async function readError(response: Response) {
  const body = await response.json().catch(() => ({} as { error?: string }));
  return body.error || "Provider governance is unavailable.";
}

/** Admin-only policy controls. They record governance state and never activate a provider. */
export function AgentProviderGovernance({ agentId }: { agentId: string }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/governance/agent-approvals?agent_id=${encodeURIComponent(agentId)}`);
    if (!response.ok) {
      setError(await readError(response));
      setApprovals([]);
    } else {
      const body = await response.json() as { approvals?: Approval[] };
      setApprovals(body.approvals ?? []);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [agentId]);

  async function update(provider: Provider, revoke: boolean) {
    setBusy(provider);
    setError("");
    setMessage("");
    const response = await fetch(
      revoke ? "/api/governance/agent-approvals/revoke" : "/api/governance/agent-approvals",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: agentId, provider }) },
    );
    if (!response.ok) setError(response.status === 503 ? "Agent-level approvals are unavailable until the governance schema is reconciled." : await readError(response));
    else {
      setMessage(revoke ? "Provider approval revoked." : "Provider approval saved. Provider activation remains disabled.");
      await load();
    }
    setBusy(null);
  }

  const active = (provider: Provider) => approvals.some((approval) => approval.provider === provider && !approval.revoked_at);

  return <section className="card" aria-label="Agent provider governance" style={{ marginTop: 18 }}>
    <ShieldCheck className="icon" size={20} />
    <h3>Provider governance</h3>
    <p className="muted">Admin-only policy approvals for this agent. These controls never connect a provider or enable calls.</p>
    {loading ? <p className="muted">Loading provider approvals…</p> : <div style={{ display: "grid", gap: 8 }}>
      {providers.map(({ id, label }) => <div key={id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
        <span>{label} <span className="muted">· {active(id) ? "approved" : "not approved"}</span></span>
        <button className="btn ghost" type="button" disabled={busy !== null} onClick={() => void update(id, active(id))}>
          {busy === id ? "Saving…" : active(id) ? "Revoke" : "Approve"}
        </button>
      </div>)}
    </div>}
    {message && <p className="notice" role="status">{message}</p>}
    {error && <p className="muted" role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
  </section>;
}
