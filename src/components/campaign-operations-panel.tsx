"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { summarizeCampaignReadiness } from "@/lib/campaign-readiness";
import { simulationPreflightSchema, type SimulationPreflight } from "@/lib/campaign-simulation";

type Campaign = { id: string; name: string; status: string; agent_id: string | null; organization_id: string; timezone: string; start_hour: number; end_hour: number; consent_required: boolean };

export function CampaignOperationsPanel({ campaigns: suppliedCampaigns }: { campaigns?: Campaign[] }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(suppliedCampaigns ?? []), [campaignId, setCampaignId] = useState(""), [snapshot, setSnapshot] = useState<SimulationPreflight | null>(null), [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (suppliedCampaigns) { setCampaigns(suppliedCampaigns); return; }
    let active = true;
    void fetch("/api/campaigns", { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Campaigns are unavailable."); if (active) setCampaigns(body.campaigns ?? []); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Campaigns are unavailable."); });
    return () => { active = false; };
  }, [suppliedCampaigns]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const readiness = useMemo(() => snapshot ? summarizeCampaignReadiness(snapshot, selectedIds) : null, [snapshot, selectedIds]);

  async function refresh(nextCampaignId = campaignId) {
    if (!nextCampaignId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(nextCampaignId)}/simulation-preflight`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error ?? "Campaign readiness is unavailable.");
      const parsed = simulationPreflightSchema.safeParse(body);
      if (!parsed.success || parsed.data.campaign.id !== nextCampaignId || parsed.data.campaign.organization_id !== parsed.data.organizationId || parsed.data.agent.organization_id !== parsed.data.organizationId || parsed.data.campaign.agent_id !== parsed.data.agent.id) throw new Error("The authorization snapshot could not be verified.");
      setSnapshot(parsed.data);
      setSelectedIds((current) => {
        const currentIds = new Set(parsed.data.contacts.map((contact) => contact.id));
        return current.size === 0 ? new Set(parsed.data.contacts.map((contact) => contact.id)) : new Set([...current].filter((id) => currentIds.has(id)));
      });
    } catch (cause) {
      setSnapshot(null); setSelectedIds(new Set()); setError(cause instanceof Error ? cause.message : "Campaign readiness is unavailable.");
    } finally { setLoading(false); }
  }

  function selectCampaign(next: string) {
    setCampaignId(next); setSnapshot(null); setSelectedIds(new Set()); setError("");
    if (next) void refresh(next);
  }

  function toggleContact(id: string) {
    setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  return <section className="card campaign-operations" aria-label="Campaign operations workspace">
    <div className="eyebrow">Campaign operations · OFFLINE ONLY</div>
    <div className="operations-heading"><div><h2>Readiness at a glance</h2><p className="muted">Inspect saved configuration and prepare a session-local rehearsal audience. No audience or execution result is saved.</p></div><span className="badge">SIMULATION ONLY</span></div>
    {campaigns.length === 0 ? <div className="empty" style={{ padding: "28px 12px" }}><h3>No campaigns to operate</h3><p className="muted">Save a campaign draft above to review consent readiness and rehearse it safely.</p></div> : <>
      <label className="label">Campaign<select className="select" aria-label="Operations campaign" value={campaignId} onChange={(event) => selectCampaign(event.target.value)}><option value="">Select a saved campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.status}</option>)}</select></label>
      {loading && <p className="muted" role="status">Refreshing tenant-scoped readiness…</p>}
      {error && <div role="alert"><p>{error}</p><button className="btn ghost" type="button" onClick={() => void refresh()} disabled={loading}>Retry readiness</button></div>}
      {snapshot && selectedCampaign && readiness && <>
        <div className="operations-config" aria-label="Saved campaign configuration"><div><span className="muted">Saved campaign</span><strong>{snapshot.campaign.name}</strong></div><div><span className="muted">Assigned agent</span><strong>{snapshot.agent.name}</strong></div><div><span className="muted">Status</span><strong>{snapshot.campaign.status.replaceAll("_", " ")}</strong></div><div><span className="muted">Calling hours</span><strong>{snapshot.campaign.start_hour}:00–{snapshot.campaign.end_hour}:00 {snapshot.campaign.timezone}</strong></div></div>
        <div className="operations-kpis" aria-label="Consent readiness counts"><div><strong>{readiness.counts.eligible}</strong><span>Eligible</span></div><div><strong>{readiness.counts.optedOut}</strong><span>Excluded / opted out</span></div><div><strong>{readiness.counts.unknownConsent}</strong><span>Unverified consent</span></div><div><strong>{readiness.counts.grantedConsent}</strong><span>Granted consent</span></div></div>
        <p className="notice" role="status"><strong>{readiness.ready ? "Ready for offline simulation" : "Not ready for offline simulation"}</strong> · {readiness.counts.eligible} eligible contact{readiness.counts.eligible === 1 ? "" : "s"} in the current session selection.</p>
        <div className="operations-audience"><div className="operations-heading"><div><h3>Session-local audience preview</h3><p className="muted">Unknown, revoked or opted-out contacts remain excluded. Selections reset on reload.</p></div><div className="operations-actions"><button className="btn ghost" type="button" onClick={() => void refresh()} disabled={loading}>Refresh readiness</button><button className="btn ghost" type="button" onClick={() => setSelectedIds(new Set(snapshot.contacts.filter((contact) => contact.eligible).map((contact) => contact.id)))}>Select eligible</button><button className="btn ghost" type="button" onClick={() => setSelectedIds(new Set())}>Clear</button></div></div>{snapshot.contacts.length === 0 ? <p className="muted">No tenant-authorized contacts are available.</p> : <div className="audience-list">{snapshot.contacts.map((contact) => <label className={`audience-row${contact.eligible ? "" : " is-excluded"}`} key={contact.id}><input type="checkbox" checked={selectedIds.has(contact.id)} onChange={() => toggleContact(contact.id)} /><span><strong>{contact.name}</strong><small>{contact.eligible ? "Eligible for offline simulation" : contact.reason ?? "Excluded by consent policy"}</small></span></label>)}</div>}</div>
        {readiness.reasons.length > 0 && <div className="notice" role="status"><strong>Readiness warnings</strong><ul>{readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
        <div className="operations-footer"><span className="muted">Selected {readiness.counts.selected} of {readiness.counts.total}. Rehearsal rechecks authorization and consent before each synthetic step.</span><Link className="btn primary" href={`/dashboard/campaigns/review?campaign=${encodeURIComponent(selectedCampaign.id)}`}>Review and rehearse</Link></div>
      </>}
    </>}
  </section>;
}
