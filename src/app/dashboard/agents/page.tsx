"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Mic2, ShieldCheck } from "lucide-react";
import { AgentProviderGovernance } from "@/components/agent-provider-governance";

type Agent = { id: string; name: string; instructions: string; language: string; voice_id?: string; status: string };
const empty = { name: "", instructions: "", language: "en-US", voice_id: "", status: "draft" };

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => { fetch("/api/agents").then(async (response) => {
    const body = await response.json();
    if (response.ok) setAgents(body.agents || []); else setError(body.error || "Unable to load agents");
  }).catch(() => setError("Unable to load agents")).finally(() => setLoading(false)); }, []);

  function update<K extends keyof typeof empty>(key: K, value: typeof empty[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const response = await fetch(editing ? `/api/agents/${editing}` : "/api/agents", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error || "Unable to save agent");
    else { setAgents((current) => editing ? current.map((agent) => agent.id === editing ? body.agent : agent) : [body.agent, ...current]); setMessage(editing ? "Agent updated." : "Draft agent created."); setForm(empty); setEditing(null); }
    setBusy(false);
  }

  async function archive(id: string) {
    if (!window.confirm("Archive this agent?")) return;
    setError(""); const response = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (!response.ok) { setError("Unable to archive agent."); return; }
    setAgents((current) => current.map((agent) => agent.id === id ? { ...agent, status: "archived" } : agent)); setMessage("Agent archived.");
  }

  return <main className="main container">
    <Link className="muted" href="/dashboard">← Back to dashboard</Link>
    <div className="section" style={{ paddingTop: 40 }}>
      <div className="eyebrow">Agent builder · safe test mode</div><h1>Build your voice agent.</h1>
      <p><Link className="btn ghost" href="/dashboard/agents/voice-preview">Open offline voice profile lab</Link></p>
      <p className="muted">Provider activation and real calls remain disabled.</p>
      <div className="grid" style={{ marginTop: 30 }}>
        <form className="card" onSubmit={save}>
          <Bot className="icon" /><h3>{editing ? "Edit agent" : "Create agent"}</h3>
          <label className="label">Agent name<input className="input" value={form.name} onChange={(event) => update("name", event.target.value)} required minLength={2} /></label>
          <label className="label">System instructions<textarea className="textarea" value={form.instructions} onChange={(event) => update("instructions", event.target.value)} maxLength={10000} /></label>
          <label className="label">Language<select className="select" value={form.language} onChange={(event) => update("language", event.target.value)}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="hi-IN">Hindi</option></select></label>
          <label className="label">Voice<select className="select" value={form.voice_id} onChange={(event) => update("voice_id", event.target.value)}><option value="">Provider voice — not connected</option><option value="safe-demo">Safe demo voice</option></select></label>
          <label className="label">Status<select className="select" value={form.status} onChange={(event) => update("status", event.target.value)}><option value="draft">Draft</option><option value="active">Active (configuration only)</option><option value="archived">Archived</option></select></label>
          <button className="btn primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create draft agent"}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setForm(empty); }}>Cancel</button>}
          {error && <p className="muted" role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
          {editing && <AgentProviderGovernance agentId={editing} />}
        </form>
        <div className="card"><Mic2 className="icon" /><h3>Saved agents</h3>
          {loading ? <p className="muted">Loading agents…</p> : agents.length === 0 ? <p className="muted">No persisted agents yet.</p> : agents.map((agent) => <div className="card" style={{ padding: 14, marginTop: 10 }} key={agent.id}>
            <strong>{agent.name}</strong><div className="muted">{agent.language} · {agent.voice_id || "No voice"} · {agent.status}</div>
            <button className="btn ghost" type="button" onClick={() => { setEditing(agent.id); setForm({ name: agent.name, instructions: agent.instructions || "", language: agent.language || "en-US", voice_id: agent.voice_id || "", status: agent.status || "draft" }); }}>Edit</button>
            {agent.status !== "archived" && <button className="btn ghost" type="button" onClick={() => void archive(agent.id)}>Archive</button>}
          </div>)}
          <div className="notice" style={{ marginTop: 18 }}><ShieldCheck size={16} /> Safe mode only. No paid provider or real calling action is available.</div>
        </div>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
    </div>
  </main>;
}
