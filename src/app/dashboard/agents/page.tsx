"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Mic2, ShieldCheck } from "lucide-react";
import { AgentProviderGovernance } from "@/components/agent-provider-governance";
import { VoiceSandboxPreparation } from "@/components/voice-sandbox-preparation";
import { voiceProfileLanguageStatus, voiceProfileState, SUPPORTED_MOCK_VOICE_ID } from "@/lib/voice-profile";
import { summarizeKnowledgeAvailability } from "@/lib/knowledge-source";

type Agent = { id: string; name: string; instructions: string; language: string; voice_id?: string; status: string };
type KnowledgeSource = { title: string; source_type: "text" | "url" | "file"; source_uri?: string | null; status?: string | null };
const empty = { name: "", instructions: "", language: "en-US", voice_id: "", status: "draft" };

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [savedForm, setSavedForm] = useState(empty);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [knowledgeError, setKnowledgeError] = useState("");

  const dirty = editing ? JSON.stringify(form) !== JSON.stringify(savedForm) : JSON.stringify(form) !== JSON.stringify(empty);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => { Promise.all([fetch("/api/agents"), fetch("/api/knowledge")]).then(async ([agentsResponse, knowledgeResponse]) => {
    const knowledgeBody = await knowledgeResponse.json().catch(() => ({}));
    if (knowledgeResponse.ok) setKnowledge(knowledgeBody.sources || []); else setKnowledgeError(knowledgeBody.error || "Knowledge source availability is unavailable.");
    const response = agentsResponse;
    const body = await response.json();
    if (response.ok) {
      const loadedAgents = body.agents || [];
      setAgents(loadedAgents);
      const requestedEdit = new URLSearchParams(window.location.search).get("edit");
      const requestedAgent = loadedAgents.find((agent: Agent) => agent.id === requestedEdit && agent.status !== "archived");
      if (requestedAgent) {
        setEditing(requestedAgent.id);
        const nextForm = { name: requestedAgent.name, instructions: requestedAgent.instructions || "", language: requestedAgent.language || "en-US", voice_id: requestedAgent.voice_id || "", status: requestedAgent.status || "draft" };
        setEditing(requestedAgent.id); setForm(nextForm); setSavedForm(nextForm);
      }
    } else setError(body.error || "Unable to load agents");
  }).catch(() => { setError("Unable to load agents"); setKnowledgeError("Knowledge source availability is unavailable."); }).finally(() => setLoading(false)); }, []);

  function update<K extends keyof typeof empty>(key: K, value: typeof empty[K]) { setForm((current) => ({ ...current, [key]: value })); }

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(editing ? `/api/agents/${editing}` : "/api/agents", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error || "Unable to save agent");
      else { setAgents((current) => editing ? current.map((agent) => agent.id === editing ? body.agent : agent) : [body.agent, ...current]); setMessage(editing ? "Agent updated." : "Draft agent created."); setForm(empty); setSavedForm(empty); setEditing(null); }
    } catch { setError("Unable to reach the agent service. Your changes are still unsaved."); }
    setBusy(false);
  }

  async function archive(id: string) {
    if (!window.confirm("Archive this agent? Archived agents cannot be tested or assigned to new campaign previews.")) return;
    setError(""); const response = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (!response.ok) { setError("Unable to archive agent."); return; }
    setAgents((current) => current.map((agent) => agent.id === id ? { ...agent, status: "archived" } : agent)); setMessage("Agent archived.");
  }

  return <main className="main container">
    <nav aria-label="Agent setup" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}><Link className="muted" href="/dashboard">← Back to dashboard</Link><Link className="muted" href="/dashboard/knowledge">Knowledge base</Link><Link className="muted" href="/dashboard/agents/test">Offline Test Studio</Link><Link className="muted" href="/dashboard/agents/performance">Agent Performance</Link></nav>
    <div className="section" style={{ paddingTop: 40 }}>
      <div className="eyebrow">Agent builder · safe test mode</div><h1>Build your voice agent.</h1>
      <p className="muted">Provider activation and real calls remain disabled.</p>
      <div className="grid" style={{ marginTop: 30 }}>
        <form className="card" onSubmit={save}>
          <Bot className="icon" /><h3>{editing ? "Edit agent" : "Create agent"}</h3><p className="muted">Configure the text behavior and mock voice used by safe local simulations.</p>
          <label className="label">Agent name<input className="input" value={form.name} onChange={(event) => update("name", event.target.value)} required minLength={2} /></label>
          <label className="label">System instructions<textarea className="textarea" value={form.instructions} onChange={(event) => update("instructions", event.target.value)} maxLength={10000} /></label>
          <label className="label">Language<select className="select" value={form.language} onChange={(event) => update("language", event.target.value)}><option value="en-US">English (US)</option><option value="en-GB">English (UK)</option><option value="hi-IN">Hindi</option></select></label>
          <label className="label" htmlFor="agent-voice">Voice profile · mock only<select id="agent-voice" className="select" value={form.voice_id} onChange={(event) => update("voice_id", event.target.value)}><option value="">No profile assigned</option><option value="safe-demo">Safe demo voice</option></select></label>
          <label className="label">Status<select className="select" value={form.status} onChange={(event) => update("status", event.target.value)}><option value="draft">Draft</option><option value="active">Active (configuration only)</option><option value="archived">Archived</option></select></label>
          {dirty && <p className="muted" role="status">Unsaved changes</p>}
          <button className="btn primary" disabled={busy || !dirty}>{busy ? "Saving…" : editing ? "Save changes" : "Create draft agent"}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { if (!dirty || window.confirm("Discard unsaved changes?")) { setEditing(null); setForm(empty); setSavedForm(empty); } }}>Cancel</button>}
          {error && <p className="muted" role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
          {editing && <AgentProviderGovernance agentId={editing} />}
        </form>
        <div className="card"><Mic2 className="icon" /><h3>Saved agents</h3>
          {loading ? <p className="muted">Loading agents…</p> : agents.length === 0 ? <p className="muted">No persisted agents yet.</p> : agents.map((agent) => <div className="card" style={{ padding: 14, marginTop: 10 }} key={agent.id}>
            <strong>{agent.name}</strong><div className="muted">{agent.language} · {agent.voice_id || "No voice profile assigned"} · {agent.status}</div>
            <div className="muted" role="status">{voiceProfileState(agent.voice_id) === "missing" ? "No voice profile assigned." : voiceProfileState(agent.voice_id) === "unsupported" ? "Voice profile saved; preview unavailable." : `Mock voice · ${voiceProfileLanguageStatus(agent.voice_id, agent.language) === "compatible" ? "language compatible" : "language review required"}`}</div>
            {agent.voice_id === SUPPORTED_MOCK_VOICE_ID && agent.status !== "archived" && <Link className="btn ghost" href={`/dashboard/agents/test?agent=${encodeURIComponent(agent.id)}&voice=preview`}>Preview voice (simulation)</Link>}
            {agent.status !== "archived" && <button className="btn ghost" type="button" onClick={() => { const nextForm = { name: agent.name, instructions: agent.instructions || "", language: agent.language || "en-US", voice_id: agent.voice_id || "", status: agent.status || "draft" }; setEditing(agent.id); setForm(nextForm); setSavedForm(nextForm); }}>Edit</button>}
            {agent.status !== "archived" && <Link className="btn ghost" href={`/dashboard/agents/test?agent=${encodeURIComponent(agent.id)}`}>Test safely</Link>}
            {agent.status !== "archived" && <button className="btn ghost" type="button" onClick={() => void archive(agent.id)}>Archive</button>}
          </div>)}
          <div className="notice" style={{ marginTop: 18 }}><ShieldCheck size={16} /> Safe mode only. No paid provider or real calling action is available.</div>
          <section className="card" aria-label="Knowledge source availability" style={{ marginTop: 18 }}><h3>Knowledge source availability</h3>{knowledgeError ? <p className="muted" role="alert">{knowledgeError}</p> : <><p className="muted">{summarizeKnowledgeAvailability(knowledge).storedReferences} organization-scoped stored reference{knowledge.length === 1 ? "" : "s"}; none are assigned to this agent.</p><p className="muted">Indexed: 0 · Retrievable: 0 · Agent assignment: unavailable under the approved schema.</p><Link className="btn ghost" href="/dashboard/knowledge">Review Knowledge Base</Link></>}</section>
        </div>
      </div>
      {message && <p className="notice" role="status">{message}</p>}
      <VoiceSandboxPreparation />
    </div>
  </main>;
}
