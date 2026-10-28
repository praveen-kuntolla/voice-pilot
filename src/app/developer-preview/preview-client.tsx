"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, BarChart3, Bot, CheckCircle2, ClipboardCheck, Contact, Download, LayoutDashboard, Megaphone, Settings2, ShieldCheck } from "lucide-react";

type Page = "Overview" | "Agents" | "Contacts" | "Campaigns" | "Calls" | "Analytics" | "Settings";
type Agent = { id: number; name: string; language: string; status: "draft" | "active" };
type Person = { id: number; name: string; consent: "granted" | "unknown" | "revoked" };
type Campaign = { id: number; name: string; agentId: number; status: "draft" | "running" | "paused" | "stopped" };
type Log = { id: number; operation: string; result: string };
const initialAgents: Agent[] = [{ id: 1, name: "Sales Qualification", language: "English", status: "active" }, { id: 2, name: "Appointment Assistant", language: "Hindi", status: "draft" }];
const initialContacts: Person[] = [{ id: 1, name: "Asha Demo", consent: "granted" }, { id: 2, name: "Ravi Demo", consent: "unknown" }, { id: 3, name: "Maya Demo", consent: "revoked" }];
const initialCampaigns: Campaign[] = [{ id: 1, name: "October Follow-up", agentId: 1, status: "draft" }];
const pages: { name: Page; icon: typeof Activity }[] = [
  { name: "Overview", icon: LayoutDashboard }, { name: "Agents", icon: Bot }, { name: "Contacts", icon: Contact }, { name: "Campaigns", icon: Megaphone },
  { name: "Calls", icon: Activity }, { name: "Analytics", icon: BarChart3 }, { name: "Settings", icon: Settings2 }
];

export default function DeveloperPreview() {
  const [page, setPage] = useState<Page>("Overview");
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [contacts, setContacts] = useState<Person[]>(initialContacts);
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [logs, setLogs] = useState<Log[]>([]);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [consent, setConsent] = useState<Person["consent"]>("unknown");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<number | null>(null);
  const [notice, setNotice] = useState("Preview ready. No backend, credentials or external provider is connected.");
  const [dark, setDark] = useState(true);
  const [safetyStop, setSafetyStop] = useState(false);
  const [outcome, setOutcome] = useState("interested");
  const [simulationCount, setSimulationCount] = useState(0);
  const [checks, setChecks] = useState<string[]>([]);
  const record = (operation: string, result: string) => {
    setLogs(old => [{ id: Date.now() + Math.random(), operation, result }, ...old].slice(0, 100));
    setNotice(result);
    setChecks(old => old.includes(operation) ? old : [...old, operation]);
  };
  const reset = () => {
    setAgents(initialAgents); setContacts(initialContacts); setCampaigns(initialCampaigns);
    setLogs([]); setChecks([]); setName(""); setEditing(null); setSimulationCount(0);
    setSafetyStop(false); setFilter("all"); setQuery(""); setConsent("unknown");
    setNotice("All synthetic preview data reset."); setPage("Overview");
  };
  const changePage = (next: Page) => { setPage(next); setName(""); setEditing(null); record("navigation", next + " screen opened."); };
  const nextId = (arr: { id: number }[]) => Math.max(0, ...arr.map(x => x.id)) + 1;
  const addAgent = () => {
    if (name.trim().length < 2) return record("validation", "Agent name must contain at least two characters.");
    if (editing !== null) {
      setAgents(old => old.map(a => a.id === editing ? { ...a, name: name.trim(), language } : a));
      record("edit_agent", "Synthetic agent updated.");
    } else {
      setAgents(old => [{ id: nextId(old), name: name.trim(), language, status: "draft" }, ...old]);
      record("create_agent", "Synthetic agent created.");
    }
    setName(""); setEditing(null);
  };
  const addContact = () => {
    if (name.trim().length < 2) return record("validation", "Contact name must contain at least two characters.");
    if (editing !== null) {
      setContacts(old => old.map(c => c.id === editing ? { ...c, name: name.trim(), consent } : c));
      record("edit_contact", "Synthetic contact updated.");
    } else {
      setContacts(old => [{ id: nextId(old), name: name.trim(), consent }, ...old]);
      record("create_contact", "Synthetic contact created.");
    }
    setName(""); setEditing(null);
  };
  const addCampaign = () => {
    if (name.trim().length < 2) return record("validation", "Campaign name must contain at least two characters.");
    if (!agents.length) return record("validation", "Create an agent first.");
    if (editing !== null) {
      setCampaigns(old => old.map(c => c.id === editing ? { ...c, name: name.trim() } : c));
      record("edit_campaign", "Synthetic campaign updated.");
    } else {
      setCampaigns(old => [{ id: nextId(old), name: name.trim(), agentId: agents[0].id, status: "draft" }, ...old]);
      record("create_campaign", "Synthetic draft campaign created.");
    }
    setName(""); setEditing(null);
  };
  const updateCampaign = (id: number, status: Campaign["status"]) => {
    if (status === "running" && safetyStop) return record("blocked_by_stop", "Emergency stop is active: simulation blocked.");
    if (status === "running" && !contacts.some(c => c.consent === "granted")) return record("blocked_by_consent", "No synthetic contacts have granted consent.");
    setCampaigns(old => old.map(c => c.id === id ? { ...c, status } : c));
    record("campaign_" + status, "Synthetic campaign status: " + status + ". No real calls.");
  };
  const simulate = () => {
    if (safetyStop) return record("blocked_by_stop", "Emergency stop is active: simulation blocked.");
    if (!contacts.some(c => c.consent === "granted")) return record("blocked_by_consent", "No consented synthetic contact; operation blocked.");
    setSimulationCount(n => n + 1);
    record("simulate_call", "Simulated outcome: " + outcome + ". No real call or audio.");
  };
  const exportJson = () => {
    const payload = JSON.stringify({ label: "SIMULATION ONLY", agents, contacts, campaigns, logs, simulationCount }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "voicepilot-synthetic-preview.json"; link.click();
    URL.revokeObjectURL(url); record("export", "Synthetic JSON report exported.");
  };
  const matches = (value: string) => value.toLowerCase().includes(query.toLowerCase());
  const visibleContacts = useMemo(() => contacts.filter(c => matches(c.name) && (filter === "all" || filter === c.consent)), [contacts, query, filter]);
  const button = (label: string, onClick: () => void, kind = "") => <button type="button" className={"vp-btn " + kind} onClick={onClick}>{label}</button>;
  const theme = dark ? "dark" : "light";
  return <div className={"vp-preview " + theme}>
    <style>{`
      .vp-preview{min-height:100vh;background:#0a1020;color:#ecf1ff;font-family:Arial,Helvetica,sans-serif;display:flex}
      .vp-preview.light{background:#edf2f8;color:#162039}
      .vp-preview *{box-sizing:border-box}
      .vp-side{width:242px;flex-shrink:0;background:#111a2b;padding:24px 16px;border-right:1px solid #26364f}
      .vp-side h2{margin:0 10px 5px;color:#fff;font-size:23px}
      .vp-side p{color:#94a6c5;margin:0 10px 28px;font-size:12px}
      .vp-nav{display:flex;flex-direction:column;gap:7px}
      .vp-nav button{display:flex;align-items:center;gap:12px;border:0;background:transparent;color:#b9c8e4;border-radius:10px;padding:13px;cursor:pointer;text-align:left}
      .vp-nav button.active,.vp-nav button:hover{background:#263a5b;color:white}
      .vp-main{flex:1;min-width:0;padding:32px;max-width:1400px}
      .vp-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
      .vp-kicker{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:#85b7ff;font-weight:bold}
      .vp-top h1{font-size:30px;margin:8px 0}
      .vp-badge{border:1px solid #436c94;color:#9ed5ff;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:bold}
      .vp-notice{padding:13px 16px;background:#233452;border:1px solid #3d5d84;border-radius:10px;margin:20px 0;font-size:14px;color:#e5efff}
      .vp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:15px;margin:20px 0}
      .vp-card{padding:20px;border-radius:15px;background:#162239;border:1px solid #2d3c56;margin-bottom:14px}
      .vp-card h3{margin:0 0 14px;font-size:18px}
      .vp-card p{color:#b4c5de}
      .vp-big{font-size:30px;font-weight:bold;margin-top:10px}
      .vp-row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .vp-stack{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
      .vp-btn{border:1px solid #607ca0;border-radius:8px;padding:10px 13px;background:#223651;color:#fff;cursor:pointer}
      .vp-btn:hover{background:#335477}
      .vp-btn.primary{background:#537cff;border-color:#537cff;color:white}
      .vp-btn.danger{background:#6f293e;border-color:#9a3a56}
      .vp-input,.vp-select{padding:11px;border:1px solid #506583;border-radius:9px;background:#0d1728;color:white;min-width:180px;max-width:100%}
      .vp-label{display:flex;flex-direction:column;gap:7px;font-size:13px;color:#b5c5df}
      .vp-item{padding:12px 0;border-top:1px solid #30415d;display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}
      .vp-note{color:#9fb2ce;font-size:13px}
      .vp-preview.light .vp-card{background:white;color:#15243e;border-color:#d5dfeb}
      .vp-preview.light .vp-notice{background:#dbe9fc;color:#1e3b61}
      .vp-preview.light .vp-card p,.vp-preview.light .vp-note{color:#4b5e78}
      @media(max-width:720px){.vp-preview{display:block}.vp-side{width:auto}.vp-nav{flex-direction:row;flex-wrap:wrap}.vp-main{padding:18px}.vp-top h1{font-size:24px}}
    `}</style>
    <aside className="vp-side"><h2>voicepilot</h2><p>LOCAL DEVELOPER PREVIEW</p>
      <nav className="vp-nav" aria-label="Developer preview navigation">{pages.map(({name: item, icon: Icon}) => <button type="button" key={item} className={page === item ? "active" : ""} aria-current={page === item ? "page" : undefined} onClick={() => changePage(item)}><Icon size={17}/>{item}</button>)}</nav>
      <div className="vp-card" style={{marginTop:25}}><ShieldCheck size={20}/><p style={{margin:"10px 0 0"}}>All records are synthetic and stored only in this browser tab's memory.</p></div>
      <Link href="/login" style={{color:"#9acaff"}}>Open real login (separate)</Link>
    </aside>
    <main className="vp-main">
      <div className="vp-top"><div><div className="vp-kicker">Developer workspace / {page}</div><h1>{page}</h1></div><span className="vp-badge">SIMULATION ONLY · {theme}</span></div>
      <div role="status" className="vp-notice">{notice}</div>
      {page === "Overview" && <>
        <div className="vp-grid">
          {[["Configured agents",agents.length],["Synthetic contacts",contacts.length],["Test campaigns",campaigns.length],["Simulated calls",simulationCount]].map(([label,value]) => <div className="vp-card" key={label}><div className="vp-note">{label}</div><div className="vp-big">{value}</div></div>)}
        </div>
        <div className="vp-card"><h3>Quick actions</h3><div className="vp-stack">{button("Create agent",()=>changePage("Agents"),"primary")}{button("Review contacts",()=>changePage("Contacts"))}{button("Open simulation",()=>changePage("Calls"))}{button("Export report",exportJson)}</div></div>
        <div className="vp-card"><h3>Developer verification</h3><p>Completed interaction categories: {checks.length}. Use each navigation tab and its controls, then review the operation log below.</p>{button("Reset synthetic workspace",reset,"danger")}</div>
      </>}
      {page === "Agents" && <>
        <div className="vp-card"><h3>{editing === null ? "New synthetic agent" : "Edit synthetic agent"}</h3><div className="vp-stack"><label className="vp-label">Agent name<input className="vp-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Agent name"/></label><label className="vp-label">Language<select className="vp-select" value={language} onChange={e=>setLanguage(e.target.value)}><option>English</option><option>Hindi</option><option>Telugu</option></select></label>{button(editing === null ? "Add agent" : "Save agent",addAgent,"primary")}{editing !== null && button("Cancel edit",()=>{setEditing(null);setName("");record("cancel_edit","Edit cancelled.");})}</div></div>
        <div className="vp-card"><h3>Agents ({agents.length})</h3>{agents.map(a=><div className="vp-item" key={a.id}><div><b>{a.name}</b><div className="vp-note">{a.language} · {a.status}</div></div><div className="vp-stack">{button("Edit",()=>{setEditing(a.id);setName(a.name);setLanguage(a.language);record("open_edit_agent","Editing synthetic agent.");})}{button(a.status==="active"?"Set draft":"Activate demo",()=>{setAgents(old=>old.map(x=>x.id===a.id?{...x,status:x.status==="active"?"draft":"active"}:x));record("toggle_agent","Synthetic agent status updated.");})}{button("Remove",()=>{setAgents(old=>old.filter(x=>x.id!==a.id));record("remove_agent","Synthetic agent removed.");},"danger")}</div></div>)}</div>
      </>}
      {page === "Contacts" && <>
        <div className="vp-card"><h3>{editing===null?"New synthetic contact":"Edit synthetic contact"}</h3><div className="vp-stack"><label className="vp-label">Contact name<input className="vp-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Contact name"/></label><label className="vp-label">Consent<select className="vp-select" value={consent} onChange={e=>setConsent(e.target.value as Person["consent"])}><option value="unknown">Unknown</option><option value="granted">Granted (synthetic)</option><option value="revoked">Revoked</option></select></label>{button(editing===null?"Add contact":"Save contact",addContact,"primary")}{editing!==null&&button("Cancel edit",()=>{setEditing(null);setName("");record("cancel_edit","Edit cancelled.");})}</div></div>
        <div className="vp-card"><div className="vp-row"><h3>Contacts ({visibleContacts.length})</h3><div className="vp-stack"><input aria-label="Search contacts" className="vp-input" placeholder="Search contacts" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Filter consent" className="vp-select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All consent</option><option value="granted">Granted</option><option value="unknown">Unknown</option><option value="revoked">Revoked</option></select></div></div>{visibleContacts.map(c=><div className="vp-item" key={c.id}><div><b>{c.name}</b><div className="vp-note">{c.consent}</div></div><div className="vp-stack">{button("Edit",()=>{setEditing(c.id);setName(c.name);setConsent(c.consent);record("open_edit_contact","Editing synthetic contact.");})}{button("Revoke",()=>{setContacts(old=>old.map(x=>x.id===c.id?{...x,consent:"revoked"}:x));record("revoke_consent","Synthetic consent revoked.");})}{button("Remove",()=>{setContacts(old=>old.filter(x=>x.id!==c.id));record("remove_contact","Synthetic contact removed.");},"danger")}</div></div>)}</div>
      </>}
      {page === "Campaigns" && <>
        <div className="vp-card"><h3>{editing===null?"New test campaign":"Edit test campaign"}</h3><div className="vp-stack"><label className="vp-label">Campaign name<input className="vp-input" placeholder="Campaign name" value={name} onChange={e=>setName(e.target.value)}/></label>{button(editing===null?"Create draft":"Save campaign",addCampaign,"primary")}{editing!==null&&button("Cancel edit",()=>{setEditing(null);setName("");record("cancel_edit","Edit cancelled.");})}</div></div>
        <div className="vp-card"><h3>Campaign operations</h3>{campaigns.map(c=><div className="vp-item" key={c.id}><div><b>{c.name}</b><div className="vp-note">{c.status} · assigned agent #{c.agentId}</div></div><div className="vp-stack">{button("Edit",()=>{setEditing(c.id);setName(c.name);record("open_edit_campaign","Editing synthetic campaign.");})}{button("Start demo",()=>updateCampaign(c.id,"running"),"primary")}{button("Pause",()=>updateCampaign(c.id,"paused"))}{button("Resume",()=>updateCampaign(c.id,"running"))}{button("Stop",()=>updateCampaign(c.id,"stopped"))}{button("Reset",()=>updateCampaign(c.id,"draft"))}{button("Remove",()=>{setCampaigns(old=>old.filter(x=>x.id!==c.id));record("remove_campaign","Synthetic campaign removed.");},"danger")}</div></div>)}</div>
      </>}
      {page === "Calls" && <>
        <div className="vp-card"><h3>Local simulated conversation</h3><p>No microphone, telephony, provider request or actual call is used.</p><div className="vp-stack"><label className="vp-label">Synthetic outcome<select className="vp-select" value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="interested">Interested</option><option value="callback_requested">Callback requested</option><option value="appointment_requested">Appointment requested</option><option value="no_answer">No answer</option><option value="opted_out">Opted out</option></select></label>{button("Simulate one call",simulate,"primary")}</div></div>
        <div className="vp-card"><h3>Simulated call history ({simulationCount})</h3>{logs.filter(l=>l.operation==="simulate_call").map(l=><div className="vp-item" key={l.id}>{l.result}</div>)}{simulationCount===0&&<p>No simulated calls yet.</p>}</div>
      </>}
      {page === "Analytics" && <>
        <div className="vp-grid"><div className="vp-card"><div className="vp-note">Total test actions</div><div className="vp-big">{logs.length}</div></div><div className="vp-card"><div className="vp-note">Completed synthetic simulations</div><div className="vp-big">{simulationCount}</div></div><div className="vp-card"><div className="vp-note">Consented synthetic contacts</div><div className="vp-big">{contacts.filter(c=>c.consent==="granted").length}</div></div></div>
        <div className="vp-card"><h3>Exportable report</h3>{button("Download synthetic JSON",exportJson,"primary")}<p>Values are based entirely on browser memory, not company data.</p></div>
      </>}
      {page === "Settings" && <>
        <div className="vp-card"><h3>Developer safety controls</h3><div className="vp-stack">{button(safetyStop?"Disable demo emergency stop":"Enable demo emergency stop",()=>{setSafetyStop(x=>!x);record("toggle_emergency_stop",safetyStop?"Demo stop disabled.":"Demo stop enabled.");},safetyStop?"danger":"primary")}{button(dark?"Use light theme":"Use dark theme",()=>{setDark(v=>!v);record("toggle_theme","Developer preview theme updated.");})}{button("Reset all synthetic data",reset,"danger")}</div><p>Emergency stop affects only this local preview. It does not change production or Supabase safety controls.</p></div>
      </>}
      <div className="vp-card" data-testid="developer-operation-log"><div className="vp-row"><h3><ClipboardCheck size={17} style={{display:"inline"}}/> Operation audit ({logs.length})</h3>{button("Clear operation log",()=>{setLogs([]);record("clear_log","Operation log cleared.");})}</div>{logs.slice(0,10).map(l=><div className="vp-item" key={l.id}><span>{l.operation}</span><span className="vp-note">{l.result}</span></div>)}{logs.length===0&&<p className="vp-note">No preview operations yet.</p>}</div>
      <p className="vp-note"><CheckCircle2 size={14} style={{display:"inline"}}/> Developer preview is intentionally isolated from real login and backend operations. Verify authenticated routes separately using local Playwright fixtures.</p>
    </main>
  </div>;
}
