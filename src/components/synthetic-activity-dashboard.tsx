"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, ArrowRight, BarChart3, Clock3, Download, RotateCcw, ShieldCheck,
  Trash2, TrendingUp, PhoneOff,
} from "lucide-react";
import {
  ACTIVITY_EVENT, clearSyntheticActivity, filterSyntheticActivity,
  readSyntheticActivity, syntheticActivityJson, syntheticActivityMetrics,
  type ActivityOutcome, type SyntheticActivity,
} from "@/lib/simulation-activity";

type View = "calls" | "analytics";
const OUTCOMES: { value: ActivityOutcome; label: string; color: string }[] = [
  { value: "interested", label: "Interested", color: "#a78bfa" },
  { value: "callback_requested", label: "Callback requested", color: "#22d3ee" },
  { value: "appointment_requested", label: "Appointment requested", color: "#34d399" },
  { value: "not_interested", label: "Not interested", color: "#94a3b8" },
  { value: "no_answer", label: "No answer", color: "#fbbf24" },
  { value: "busy", label: "Busy", color: "#fb923c" },
  { value: "wrong_number", label: "Wrong number", color: "#f472b6" },
  { value: "opted_out", label: "Opted out", color: "#f87171" },
  { value: "error", label: "Mock error", color: "#ef4444" },
  { value: "skipped", label: "Excluded by preflight", color: "#64748b" },
];
const nameFor = (outcome: ActivityOutcome) => OUTCOMES.find((item) => item.value === outcome)?.label ?? "Synthetic outcome";
const number = (value: number) => new Intl.NumberFormat("en").format(value);

function useTabActivity(organizationId: string) {
  const [records, setRecords] = useState<SyntheticActivity[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    function refresh() { setRecords(readSyntheticActivity(organizationId)); setLoaded(true); }
    refresh();
    window.addEventListener(ACTIVITY_EVENT, refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener(ACTIVITY_EVENT, refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [organizationId]);
  return { records, loaded };
}

function Stat({ label, value, description }: { label: string; value: string | number; description: string }) {
  return <div className="card" style={{ minWidth: 0, padding: 20 }}>
    <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    <strong style={{ display: "block", fontSize: 30, marginTop: 10, letterSpacing: "-.04em" }}>{value}</strong>
    <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{description}</div>
  </div>;
}

export default function SyntheticActivityDashboard({ organizationId, view }: { organizationId: string; view: View }) {
  const { records, loaded } = useTabActivity(organizationId);
  const [outcome, setOutcome] = useState("all");
  const [days, setDays] = useState("30");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const filtered = useMemo(() => filterSyntheticActivity(records, { outcome, days: Number(days) }), [records, outcome, days]);
  const metrics = useMemo(() => syntheticActivityMetrics(filtered), [filtered]);
  const selected = filtered.find((record) => record.id === selectedId);
  const descending = useMemo(() => [...filtered].reverse(), [filtered]);

  function download() {
    const text = syntheticActivityJson(filtered);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const element = document.createElement("a");
    element.href = url;
    element.download = "voicepilot-tab-synthetic-outcomes.json";
    element.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage("Redacted synthetic JSON prepared. No contact identifiers were exported.");
  }

  function clear() {
    if (!window.confirm("Clear this organization's synthetic activity in this browser tab?")) return;
    clearSyntheticActivity(organizationId);
    setSelectedId(null);
    setMessage("Synthetic activity cleared from this browser tab.");
  }

  const isCalls = view === "calls";
  return <main className="main container" style={{ maxWidth: 1250, paddingTop: 34, paddingBottom: 90 }}>
    <div className="eyebrow">VoicePilot Workspace / Offline intelligence</div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginTop: 13 }}>
      <div>
        <h1 style={{ fontSize: "clamp(32px, 5vw, 46px)", letterSpacing: "-.055em", margin: "0 0 10px" }}>
          {isCalls ? "Simulated calls" : "Simulation analytics"}
        </h1>
        <p className="muted" style={{ maxWidth: 680, margin: 0 }}>
          {isCalls
            ? "Inspect terminal outcomes from campaign tests, without contacting anyone."
            : "See performance summaries from synthetic campaign outcomes in this browser tab."}
        </p>
      </div>
      <Link className="btn primary" href="/dashboard/campaigns#simulation-studio">
        Open simulation studio <ArrowRight size={16} />
      </Link>
    </div>

    <div className="notice" style={{ marginTop: 24, display: "flex", gap: 12, alignItems: "flex-start" }}>
      <ShieldCheck size={20} style={{ flexShrink: 0 }} />
      <span><strong>SIMULATION ONLY.</strong> These are not real call records or customer analytics. Only redacted outcome
        categories and timestamps are kept temporarily in this browser tab for the selected organization.
        No contacts, transcripts, numbers, provider requests, server analytics, or billing data are stored here.</span>
    </div>

    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 22, marginBottom: 20 }}>
      <Link className={isCalls ? "btn primary" : "btn ghost"} href="/dashboard/calls"><Activity size={16} /> Calls</Link>
      <Link className={!isCalls ? "btn primary" : "btn ghost"} href="/dashboard/analytics"><BarChart3 size={16} /> Analytics</Link>
      <Link className="btn ghost" href="/dashboard">Workspace overview</Link>
    </div>

    <section className="card" aria-label="Synthetic activity filters" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", flex: "1 1 350px" }}>
          <label className="label" style={{ flex: "1 1 160px" }}>Outcome filter
            <select className="select" aria-label="Outcome filter" value={outcome} onChange={(event) => { setOutcome(event.target.value); setSelectedId(null); }} style={{ marginBottom: 0 }}>
              <option value="all">All outcomes</option>
              {OUTCOMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="label" style={{ flex: "1 1 150px" }}>Time range
            <select className="select" aria-label="Time range" value={days} onChange={(event) => { setDays(event.target.value); setSelectedId(null); }} style={{ marginBottom: 0 }}>
              <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
            </select>
          </label>
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          <button type="button" className="btn ghost" disabled={filtered.length === 0} onClick={download}><Download size={15} /> Download redacted JSON</button>
          <button type="button" className="btn ghost" disabled={records.length === 0} onClick={clear}><Trash2 size={15} /> Clear tab activity</button>
        </div>
      </div>
      {message && <p className="muted" role="status" style={{ marginBottom: 0 }}>{message}</p>}
    </section>

    <div className="kpis" style={{ marginTop: 18 }}>
      <Stat label="Synthetic outcomes" value={number(metrics.total)} description="Selected time range and filter" />
      <Stat label="Mock completed" value={number(metrics.completed)} description="Terminal simulated conversations" />
      <Stat label="Callback scenarios" value={number(metrics.callbacks)} description="Mock follow-up requests" />
      <Stat label="Mock completion rate" value={`${metrics.completionRate}%`} description="Completed / all synthetic outcomes" />
    </div>

    {!loaded ? <section className="card" style={{ marginTop: 20 }} role="status">Loading tab-only activity…</section>
    : records.length === 0 ? <section className="card empty" style={{ marginTop: 20 }} aria-label="No synthetic outcomes yet">
      <PhoneOff size={34} className="icon" style={{ margin: "0 auto 12px" }} />
      <h2 style={{ margin: "0 0 12px", fontSize: 24 }}>No synthetic outcomes yet</h2>
      <p className="muted">Run a mock campaign in the Simulation Studio to populate this view. No real calls will be placed.</p>
      <Link className="btn primary" href="/dashboard/campaigns#simulation-studio">Go to simulation studio <ArrowRight size={16} /></Link>
    </section> : filtered.length === 0 ? <section className="card empty" style={{ marginTop: 20 }}>
      <h2 style={{ fontSize: 22 }}>No outcomes match these filters</h2>
      <p className="muted">Try another outcome or a longer time range.</p>
      <button className="btn ghost" type="button" onClick={() => { setOutcome("all"); setDays("30"); }}><RotateCcw size={15} /> Reset filters</button>
    </section> : isCalls ? <>
      <section className="card" style={{ marginTop: 20, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 21, margin: "0 0 12px" }}>Recent synthetic activity</h2>
          <span className="muted" style={{ fontSize: 12 }}>Most recent first · up to 200 outcome summaries per tab</span>
        </div>
        <table className="table" aria-label="Synthetic activity table">
          <thead><tr><th>Time</th><th>State</th><th>Mock outcome</th><th>Details</th></tr></thead>
          <tbody>{descending.map((item) => <tr key={item.id}>
            <td>{new Date(item.observedAt).toLocaleString()}</td>
            <td>{item.state.replaceAll("_", " ")}</td>
            <td><span className="badge">{nameFor(item.outcome)}</span></td>
            <td><button className="btn ghost" type="button" onClick={() => setSelectedId(selectedId === item.id ? null : item.id)}>View outcome</button></td>
          </tr>)}</tbody>
        </table>
      </section>
      {selected && <section className="card" style={{ marginTop: 16 }} aria-label="Selected synthetic outcome">
        <h2 style={{ fontSize: 20 }}>Synthetic outcome details</h2>
        <p><strong>{nameFor(selected.outcome)}</strong> · {selected.state.replaceAll("_", " ")}</p>
        <p className="muted">Recorded in this tab: {new Date(selected.observedAt).toLocaleString()}</p>
        <p className="muted">No contact, phone, transcript, or real call identifier is attached to this record.</p>
        <button className="btn ghost" type="button" onClick={() => setSelectedId(null)}>Close details</button>
      </section>}
    </> : <>
      <div className="grid" style={{ marginTop: 20, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <section className="card" aria-label="Synthetic outcome breakdown">
          <h2 style={{ margin: "0 0 20px", fontSize: 21 }}>Outcome distribution</h2>
          {OUTCOMES.filter((item) => filtered.some((record) => record.outcome === item.value)).map((item) => {
            const count = filtered.filter((record) => record.outcome === item.value).length;
            return <div key={item.value} style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginBottom: 6 }}><span>{item.label}</span><strong>{count}</strong></div>
              <div style={{ height: 9, borderRadius: 8, background: "#282b40", overflow: "hidden" }}>
                <div style={{ width: `${(count / metrics.total) * 100}%`, background: item.color, height: "100%", borderRadius: 8 }} />
              </div>
            </div>;
          })}
        </section>
        <section className="card" aria-label="Synthetic funnel summary">
          <h2 style={{ margin: "0 0 20px", fontSize: 21 }}>Scenario funnel</h2>
          {[
            { label: "All simulated outcomes", value: metrics.total, icon: Activity },
            { label: "Mock completed", value: metrics.completed, icon: TrendingUp },
            { label: "Mock interested", value: metrics.interested, icon: BarChart3 },
            { label: "Callback or appointment requests", value: metrics.callbacks + metrics.appointments, icon: Clock3 },
            { label: "Excluded by policy", value: metrics.excluded, icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid var(--line)", padding: "13px 0" }}>
            <Icon size={18} className="icon" /><span style={{ flex: 1, fontSize: 13 }}>{label}</span><strong>{number(value)}</strong>
          </div>)}
          <p className="muted" style={{ fontSize: 12, marginTop: 17 }}>This funnel counts mock outcomes only. It is not a conversion or revenue report.</p>
        </section>
      </div>
      <section className="card" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 21, marginTop: 0 }}>About these analytics</h2>
        <p className="muted">These summary calculations come from the same locally generated outcome events as the Calls page. Filters apply to both pages. All activity is scoped to the current organization and lasts only in this browser tab (maximum 30 days, 200 rows). Clearing the tab data affects the dashboard only, not contact or campaign configuration.</p>
      </section>
    </>}
  </main>;
}
