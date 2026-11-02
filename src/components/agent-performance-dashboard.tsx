"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, RotateCcw, ShieldCheck } from "lucide-react";
import { OFFLINE_PERFORMANCE_EVENT, readOfflineEvaluationSnapshot, summarizeOfflinePerformance, type OfflineEvaluationSnapshot } from "@/lib/offline-agent-performance";

type Agent = { id: string; name: string; language?: string | null; voice_id?: string | null; status?: string | null };

function scoreLabel(score: number) { return score >= 80 ? "Healthy" : score >= 60 ? "Review" : "Needs attention"; }

export default function AgentPerformanceDashboard({ organizationId, agents }: { organizationId: string; agents: Agent[] }) {
  const [agentId, setAgentId] = useState(agents.find((agent) => agent.status !== "archived")?.id ?? "");
  const [snapshot, setSnapshot] = useState<OfflineEvaluationSnapshot | null>(null);
  const selectedAgent = agents.find((agent) => agent.id === agentId);

  function refresh() { setSnapshot(agentId ? readOfflineEvaluationSnapshot(organizationId, agentId) : null); }
  useEffect(() => { refresh(); }, [agentId, organizationId]);
  useEffect(() => {
    const onUpdate = () => refresh();
    window.addEventListener(OFFLINE_PERFORMANCE_EVENT, onUpdate);
    return () => window.removeEventListener(OFFLINE_PERFORMANCE_EVENT, onUpdate);
  }, [agentId, organizationId]);

  const summary = useMemo(() => snapshot ? summarizeOfflinePerformance(snapshot) : null, [snapshot]);
  const warningGroups = useMemo(() => {
    if (!summary) return [];
    const groups = new Map<string, string[]>();
    for (const warning of summary.evaluation.warnings) {
      const category = /preflight|authorized/i.test(warning) ? "Authorization" : /simulation|conversation/i.test(warning) ? "Lifecycle" : "Configuration";
      groups.set(category, [...(groups.get(category) ?? []), warning]);
    }
    return [...groups.entries()];
  }, [summary]);

  return <main className="main container agent-performance" aria-label="Agent performance workspace">
    <nav aria-label="Agent performance navigation" className="agent-performance-nav"><Link className="muted" href="/dashboard/agents">← Agent Builder</Link><Link className="muted" href="/dashboard/agents/test">Offline Test Studio</Link><Link className="muted" href="/dashboard/analytics">Simulation Analytics</Link></nav>
    <div className="section">
      <div className="eyebrow">Agent performance · OFFLINE ONLY</div>
      <div className="agent-performance-heading"><div><h1>Evaluate your agents safely.</h1><p className="muted">Review rule-based synthetic evaluations from this browser session. These are not call-quality scores, customer outcomes, or persisted history.</p></div><span className="badge">SIMULATION ONLY</span></div>
      <section className="notice agent-performance-notice" role="note"><ShieldCheck size={18} aria-hidden="true" /><span><strong>Tenant-scoped and session-local.</strong> Only agents returned for the current organization are selectable. Resetting the Offline Test Studio clears the current agent evaluation.</span></section>
      {agents.length === 0 ? <section className="card empty" aria-label="No agents available"><h2>No agents available</h2><p className="muted">Create an agent in the authorized workspace before running an offline evaluation.</p><Link className="btn primary" href="/dashboard/agents">Open Agent Builder</Link></section> : <>
        <label className="label agent-performance-selector">Agent<select className="select" aria-label="Performance agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">Select an agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agent.status === "archived" ? " · archived" : ""}</option>)}</select></label>
        {!selectedAgent || !summary || !snapshot ? <section className="card empty" aria-label="No synthetic evaluation"><BarChart3 size={34} className="icon" aria-hidden="true" /><h2>No synthetic evaluation yet</h2><p className="muted">Run at least one authorized mock turn for {selectedAgent?.name ?? "this agent"} in the Offline Test Studio. Nothing is fabricated or loaded from historical call records.</p>{selectedAgent && selectedAgent.status !== "archived" && <Link className="btn primary" href={`/dashboard/agents/test?agent=${encodeURIComponent(selectedAgent.id)}`}>Run offline evaluation</Link>}</section> : <>
          <div className="agent-performance-grid" aria-label="Synthetic evaluation scorecards">
            <section className="card performance-scorecard"><span className="muted">Synthetic evaluation score</span><strong>{summary.score}/100</strong><span className="badge">{scoreLabel(summary.score)}</span><small>Rule-based configuration and lifecycle summary; not a quality or conversion score.</small></section>
            <section className="card performance-scorecard"><span className="muted">Conversation completion</span><strong>{summary.completionRate}%</strong><span className="muted">{summary.completed} of {summary.total} synthetic turn{summary.total === 1 ? "" : "s"} completed</span><small>Completion is based on local mock lifecycle events only.</small></section>
            <section className="card performance-scorecard"><span className="muted">Evaluation state</span><strong>{snapshot.state}</strong><span className="muted">{snapshot.turns} turn{snapshot.turns === 1 ? "" : "s"} evaluated</span><small>Last updated {new Date(snapshot.updatedAt).toLocaleString()}</small></section>
          </div>
          <section className="card performance-breakdown" aria-label="Synthetic success and failure breakdown"><div className="performance-section-heading"><div><h2>Session outcome breakdown</h2><p className="muted">Synthetic conversation history from the current browser session only.</p></div><button className="btn ghost" type="button" onClick={refresh}><RotateCcw size={15} aria-hidden="true" /> Refresh</button></div>{[{ label: "Completed", value: summary.completed, tone: "success" }, { label: "Failed", value: summary.failed, tone: "danger" }, { label: "Interrupted", value: summary.interrupted, tone: "warning" }].map((item) => <div className="performance-bar-row" key={item.label}><span>{item.label}</span><div className="performance-bar" role="img" aria-label={`${item.label}: ${item.value}`}><span className={`performance-bar-fill ${item.tone}`} style={{ width: `${summary.total ? (item.value / summary.total) * 100 : 0}%` }} /></div><strong>{item.value}</strong></div>)}</section>
          <section className="card" aria-label="Evaluation warnings"><h2>Evaluation warnings</h2>{warningGroups.length === 0 ? <p className="muted"><CheckCircle2 size={15} aria-hidden="true" /> No deterministic warnings for this synthetic session.</p> : warningGroups.map(([category, warnings]) => <div className="performance-warning-group" key={category}><strong><AlertTriangle size={15} aria-hidden="true" /> {category}</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>)}</section>
          <section className="card" aria-label="Synthetic conversation history"><h2>Conversation history</h2>{snapshot.outcomes.length === 0 ? <p className="muted">No completed synthetic turns are available.</p> : <ol className="performance-history">{snapshot.outcomes.map((item) => <li key={`${item.turn}-${item.completedAt}`}><strong>Turn {item.turn}</strong><span className={`badge outcome-${item.outcome}`}>{item.outcome}</span><span className="muted">{new Date(item.completedAt).toLocaleString()}</span></li>)}</ol>}<p className="muted performance-disclaimer">No transcript, audio, provider request, contact identifier, or customer data is stored in this dashboard.</p></section>
        </>}
      </>}
    </div>
  </main>;
}
