"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Shield, User, ChevronRight, CheckCircle, XCircle, AlertCircle, RotateCcw } from "lucide-react";

// ── Types (mirrors API responses) ──────────────────────────────────────────────
type Tab = "profile" | "governance";
type Provider = "deepgram" | "openai" | "elevenlabs";
const PROVIDERS: Provider[] = ["deepgram", "openai", "elevenlabs"];

interface OrgApproval {
  organization_id: string;
  provider: Provider;
  credential_reference: string;
  approved_by: string;
  approved_at?: string;
  revoked_at?: string | null;
}

interface AgentApproval {
  agent_id: string;
  provider: Provider;
  approved_by: string;
  revoked_at?: string | null;
}

interface PrivacyPolicy {
  audio_retention_days: number;
  transcript_retention_days: number;
  consent_required: boolean;
  permitted_regions: string[];
  redact_diagnostics: boolean;
}

interface Quota {
  provider: Provider;
  max_session_estimated_cost: number;
  max_organization_estimated_cost: number;
  max_concurrent_sessions: number;
}

interface UsageSummary { provider: Provider; period_start: string; estimated_cost: number }
interface AuditEvent { id: string; actor_id: string | null; action: string; provider: Provider | null; created_at: string; metadata: Record<string, unknown> }

const PROVIDER_LABELS: Record<Provider, string> = {
  deepgram: "Deepgram (STT)",
  openai: "OpenAI (LLM)",
  elevenlabs: "ElevenLabs (TTS)",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonFetch(url: string, method: string, body?: unknown) {
  return fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatusBadge({ active }: { active: boolean }) {
  return active
    ? <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: 4 }}><CheckCircle size={14} /> Active</span>
    : <span style={{ color: "#f87171", display: "inline-flex", alignItems: "center", gap: 4 }}><XCircle size={14} /> Revoked</span>;
}

// ── Profile Panel ─────────────────────────────────────────────────────────────
function ProfilePanel() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((x: { profile?: { full_name?: string }; user?: { email?: string } }) => {
        setName(x.profile?.full_name ?? "");
        setEmail(x.user?.email ?? "");
      });
  }, []);

  return (
    <div className="form-wrap">
      <div className="eyebrow">Account</div>
      <h2>Profile settings</h2>
      <p className="muted">{email}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await jsonFetch("/api/profile", "PATCH", { full_name: name });
          setMessage(r.ok ? "Profile updated." : "Unable to update profile.");
        }}
      >
        <label className="label">
          Full name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
        </label>
        <button className="btn primary" type="submit">Save profile</button>
      </form>
      {message && <p className="notice">{message}</p>}
    </div>
  );
}

// ── Governance Panel ──────────────────────────────────────────────────────────
function GovernancePanel() {
  const [orgApprovals, setOrgApprovals] = useState<OrgApproval[]>([]);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyPolicy | null>(null);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  // Org approval form state
  const [newProvider, setNewProvider] = useState<Provider>("deepgram");
  const [newCredRef, setNewCredRef] = useState("");

  // Privacy form state
  const [privacyForm, setPrivacyForm] = useState<PrivacyPolicy>({
    audio_retention_days: 0, transcript_retention_days: 30,
    consent_required: true, permitted_regions: [], redact_diagnostics: true,
  });

  // Quota form state
  const [quotaProvider, setQuotaProvider] = useState<Provider>("deepgram");
  const [quotaSession, setQuotaSession] = useState("0");
  const [quotaOrg, setQuotaOrg] = useState("0");
  const [quotaConcurrent, setQuotaConcurrent] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [orgR, quotaR, privR, usageR, auditR] = await Promise.all([
        fetch("/api/governance/org-approvals").then((r) => r.json() as Promise<{ approvals?: OrgApproval[]; error?: string }>),
        fetch("/api/governance/quotas").then((r) => r.json() as Promise<{ quotas?: Quota[]; error?: string }>),
        fetch("/api/governance/privacy-policy").then((r) => r.json() as Promise<{ policy?: PrivacyPolicy | null; error?: string }>),
        fetch("/api/governance/usage").then((r) => r.json() as Promise<{ summary?: UsageSummary[]; error?: string }>),
        fetch("/api/governance/audit?limit=20").then((r) => r.json() as Promise<{ events?: AuditEvent[]; error?: string }>),
      ]);
      if (orgR.error) throw new Error(orgR.error);
      setOrgApprovals(orgR.approvals ?? []);
      setQuotas(quotaR.quotas ?? []);
      if (privR.policy) {
        setPrivacy(privR.policy);
        setPrivacyForm(privR.policy);
      }
      setUsage(usageR.summary ?? []);
      setAudit(auditR.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load governance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function grantOrgApproval(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!newCredRef.trim()) { setMsg("Credential reference is required."); return; }
    const r = await jsonFetch("/api/governance/org-approvals", "POST", {
      provider: newProvider, credential_reference: newCredRef.trim(),
    });
    if (r.ok) { setMsg("Approval granted."); setNewCredRef(""); await load(); }
    else { const d = await r.json() as { error?: string }; setMsg(d.error ?? "Failed to grant approval."); }
  }

  async function revokeOrgApproval(p: Provider) {
    setMsg("");
    const r = await jsonFetch("/api/governance/org-approvals/revoke", "POST", { provider: p });
    if (r.ok) { setMsg(`${p} approval revoked.`); await load(); }
    else { const d = await r.json() as { error?: string }; setMsg(d.error ?? "Failed to revoke."); }
  }

  async function savePrivacy(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await jsonFetch("/api/governance/privacy-policy", "PUT", privacyForm);
    if (r.ok) { setMsg("Privacy policy saved."); await load(); }
    else { const d = await r.json() as { error?: string }; setMsg(d.error ?? "Failed to save privacy policy."); }
  }

  async function saveQuota(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const r = await jsonFetch("/api/governance/quotas", "PUT", {
      provider: quotaProvider,
      max_session_estimated_cost: parseFloat(quotaSession) || 0,
      max_organization_estimated_cost: parseFloat(quotaOrg) || 0,
      max_concurrent_sessions: parseInt(quotaConcurrent) || 0,
    });
    if (r.ok) { setMsg("Quota saved."); await load(); }
    else { const d = await r.json() as { error?: string }; setMsg(d.error ?? "Failed to save quota."); }
  }

  if (loading) return <p className="muted">Loading governance data…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {error && (
        <div className="notice" style={{ color: "#fca5a5", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {msg && <p className="notice">{msg}</p>}

      {/* ── Org Provider Approvals ── */}
      <section className="card">
        <h3>Organization provider approvals</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Grant or revoke provider access for this organization. Each provider also requires per-agent approval.
          Credential references are opaque identifiers — never put actual credentials here.
        </p>
        <div className="notice" style={{ marginBottom: 16 }}>
          <Shield size={14} style={{ display: "inline", marginRight: 4 }} />
          All provider activation flags remain disabled. Approvals are stored for future use only.
        </div>
        {orgApprovals.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                {["Provider", "Reference", "Status", "Approved", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", paddingBottom: 8, color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgApprovals.map((a) => (
                <tr key={a.provider} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 0" }}><strong>{PROVIDER_LABELS[a.provider]}</strong></td>
                  <td className="muted" style={{ fontSize: 13 }}>{a.credential_reference}</td>
                  <td><StatusBadge active={!a.revoked_at} /></td>
                  <td className="muted" style={{ fontSize: 12 }}>{a.approved_at ? new Date(a.approved_at).toLocaleDateString() : "—"}</td>
                  <td>
                    {!a.revoked_at && (
                      <button className="btn ghost" style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => void revokeOrgApproval(a.provider)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={(e) => void grantOrgApproval(e)} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="label" style={{ flex: 1, minWidth: 160 }}>
            Provider
            <select className="input" value={newProvider} onChange={(e) => setNewProvider(e.target.value as Provider)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
            </select>
          </label>
          <label className="label" style={{ flex: 2, minWidth: 200 }}>
            Credential reference (opaque ID, not a secret)
            <input className="input" value={newCredRef} onChange={(e) => setNewCredRef(e.target.value)}
              placeholder="e.g. deepgram-prod-ref-001" minLength={3} maxLength={256} />
          </label>
          <button className="btn primary" type="submit">Grant approval</button>
        </form>
      </section>

      {/* ── Privacy Policy ── */}
      <section className="card">
        <h3>Privacy &amp; data policy</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Configure audio and transcript retention, consent requirements, processing regions, and diagnostic redaction.
          This is application architecture — not a legal or compliance assessment.
        </p>
        <form onSubmit={(e) => void savePrivacy(e)} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label className="label" style={{ flex: 1, minWidth: 180 }}>
              Audio retention (days, 0 = do not retain)
              <input className="input" type="number" min={0} max={365} value={privacyForm.audio_retention_days}
                onChange={(e) => setPrivacyForm((f) => ({ ...f, audio_retention_days: parseInt(e.target.value) || 0 }))} />
            </label>
            <label className="label" style={{ flex: 1, minWidth: 180 }}>
              Transcript retention (days)
              <input className="input" type="number" min={0} max={365} value={privacyForm.transcript_retention_days}
                onChange={(e) => setPrivacyForm((f) => ({ ...f, transcript_retention_days: parseInt(e.target.value) || 0 }))} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={privacyForm.consent_required}
                onChange={(e) => setPrivacyForm((f) => ({ ...f, consent_required: e.target.checked }))} />
              Consent required before voice processing
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={privacyForm.redact_diagnostics}
                onChange={(e) => setPrivacyForm((f) => ({ ...f, redact_diagnostics: e.target.checked }))} />
              Redact PII in diagnostics
            </label>
          </div>
          <label className="label">
            Permitted processing regions (comma-separated, empty = unrestricted)
            <input className="input" value={privacyForm.permitted_regions.join(",")}
              onChange={(e) => setPrivacyForm((f) => ({
                ...f,
                permitted_regions: e.target.value.split(",").map((r) => r.trim()).filter(Boolean),
              }))}
              placeholder="e.g. us-east-1,eu-west-1" />
          </label>
          <button className="btn primary" type="submit" style={{ alignSelf: "flex-start" }}>Save privacy policy</button>
        </form>
      </section>

      {/* ── Quotas ── */}
      <section className="card">
        <h3>Usage quotas &amp; cost controls</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Set cost and concurrency limits per provider. Zero means no limit.
          Estimated costs are manual — not provider invoices.
        </p>
        {quotas.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr>
                {["Provider", "Session cap ($)", "Org cap ($)", "Concurrent sessions"].map((h) => (
                  <th key={h} style={{ textAlign: "left", paddingBottom: 8, color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotas.map((q) => (
                <tr key={q.provider} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 0" }}><strong>{PROVIDER_LABELS[q.provider]}</strong></td>
                  <td className="muted">{q.max_session_estimated_cost === 0 ? "Unlimited" : `$${q.max_session_estimated_cost.toFixed(4)}`}</td>
                  <td className="muted">{q.max_organization_estimated_cost === 0 ? "Unlimited" : `$${q.max_organization_estimated_cost.toFixed(2)}`}</td>
                  <td className="muted">{q.max_concurrent_sessions === 0 ? "Unlimited" : q.max_concurrent_sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={(e) => void saveQuota(e)} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="label" style={{ minWidth: 160 }}>
            Provider
            <select className="input" value={quotaProvider} onChange={(e) => setQuotaProvider(e.target.value as Provider)}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
            </select>
          </label>
          <label className="label" style={{ minWidth: 120 }}>
            Session cap ($)
            <input className="input" type="number" min={0} step={0.0001} value={quotaSession} onChange={(e) => setQuotaSession(e.target.value)} />
          </label>
          <label className="label" style={{ minWidth: 120 }}>
            Org cap ($)
            <input className="input" type="number" min={0} step={0.01} value={quotaOrg} onChange={(e) => setQuotaOrg(e.target.value)} />
          </label>
          <label className="label" style={{ minWidth: 120 }}>
            Concurrent sessions
            <input className="input" type="number" min={0} step={1} value={quotaConcurrent} onChange={(e) => setQuotaConcurrent(e.target.value)} />
          </label>
          <button className="btn primary" type="submit">Set quota</button>
        </form>
      </section>

      {/* ── Usage Summary ── */}
      <section className="card">
        <h3>Usage summary <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>(last 30 days)</span></h3>
        <button className="btn ghost" style={{ fontSize: 12, padding: "4px 10px", marginBottom: 12 }}
          onClick={() => void load()}>
          <RotateCcw size={12} style={{ marginRight: 4 }} /> Refresh
        </button>
        {usage.length === 0
          ? <p className="muted">No usage recorded for this period.</p>
          : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Period", "Provider", "Estimated cost"].map((h) => (
                    <th key={h} style={{ textAlign: "left", paddingBottom: 8, color: "var(--muted)", fontSize: 12, fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.map((u, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 0" }} className="muted">{u.period_start}</td>
                    <td><strong>{PROVIDER_LABELS[u.provider] ?? u.provider}</strong></td>
                    <td className="muted">${u.estimated_cost.toFixed(6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>

      {/* ── Audit Log ── */}
      <section className="card">
        <h3>Governance audit log <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>(immutable)</span></h3>
        <p className="muted" style={{ marginBottom: 12 }}>Last 20 events. Written automatically by database triggers.</p>
        {audit.length === 0
          ? <p className="muted">No audit events recorded.</p>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {audit.map((ev) => (
                <div key={ev.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <ChevronRight size={14} style={{ color: "var(--muted)", flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <strong style={{ fontSize: 13 }}>{ev.action.replace(/_/g, " ")}</strong>
                      {ev.provider && <span className="muted" style={{ fontSize: 12 }}>· {PROVIDER_LABELS[ev.provider] ?? ev.provider}</span>}
                    </div>
                    <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {new Date(ev.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Settings() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <main className="container section">
      <Link className="muted" href="/dashboard">← Back to dashboard</Link>
      <div style={{ marginTop: 30 }}>
        <div className="eyebrow">Settings</div>
        <h1>Organization settings</h1>

        {/* Tab nav */}
        <div style={{ display: "flex", gap: 4, marginTop: 24, marginBottom: 32, borderBottom: "1px solid var(--border)" }}>
          {([
            { id: "profile", label: "Profile", icon: <User size={14} /> },
            { id: "governance", label: "Provider governance", icon: <Shield size={14} /> },
          ] as const).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "btn primary" : "btn ghost"}
              style={{ borderRadius: "6px 6px 0 0", borderBottom: "none", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => setTab(t.id)}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === "profile" && <ProfilePanel />}
        {tab === "governance" && <GovernancePanel />}
      </div>
    </main>
  );
}
