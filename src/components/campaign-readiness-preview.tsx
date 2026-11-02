"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { simulationPreflightSchema, type SimulationPreflight } from "@/lib/campaign-simulation";
import { summarizeCampaignReadiness, type CampaignReadiness } from "@/lib/campaign-readiness";

export function CampaignReadinessPreview({ campaignId, onSelectionChange }: { campaignId: string; onSelectionChange?: (ids: ReadonlySet<string>) => void }) {
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [snapshot, setSnapshot] = useState<SimulationPreflight | null>(null), [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set()), hasPreviewedRef = useRef(false), campaignRef = useRef(campaignId);
  const readiness = useMemo(() => snapshot ? summarizeCampaignReadiness(snapshot, selectedIds) : null, [snapshot, selectedIds]);
  useEffect(() => { if (snapshot) onSelectionChange?.(selectedIds); }, [onSelectionChange, selectedIds, snapshot]);
  useEffect(() => { if (campaignRef.current !== campaignId) { campaignRef.current = campaignId; hasPreviewedRef.current = false; selectedIdsRef.current = new Set(); setSnapshot(null); setSelectedIds(new Set()); } }, [campaignId]);
  async function preview() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/simulation-preflight`, { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error((body as { error?: string }).error ?? "Readiness preview is unavailable.");
      const parsed = simulationPreflightSchema.safeParse(body);
      if (!parsed.success || parsed.data.organizationId !== parsed.data.campaign.organization_id || parsed.data.agent.organization_id !== parsed.data.organizationId || parsed.data.campaign.agent_id !== parsed.data.agent.id) throw new Error("The authorization snapshot could not be verified.");
      const selected = selectedIdsRef.current;
      const next = parsed.data.contacts.filter((contact) => selected.has(contact.id));
      const initial = hasPreviewedRef.current ? new Set(next.map((contact) => contact.id)) : new Set(parsed.data.contacts.map((contact) => contact.id));
      hasPreviewedRef.current = true;
      selectedIdsRef.current = initial; setSnapshot(parsed.data); setSelectedIds(initial);
    } catch (cause) {
      const empty = new Set<string>(); selectedIdsRef.current = empty; setSnapshot(null); setSelectedIds(empty); setError(cause instanceof Error ? cause.message : "Readiness preview is unavailable.");
    } finally { setLoading(false); }
  }
  function toggle(id: string) { setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); selectedIdsRef.current = next; return next; }); }
  return <div className="card" aria-label="Campaign readiness preview" style={{ marginTop: 12 }}><div className="eyebrow">Campaign review · SIMULATION ONLY</div><p className="muted">This is an organization-wide hypothetical contact pool. The approved schema has no campaign-contact relationship, so selections are session-local and never saved.</p><nav aria-label="Campaign review navigation" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}><a className="muted" href="/dashboard/contacts">Manage contacts and consent</a><a className="muted" href="/dashboard/campaigns">Edit campaign</a></nav><button className="btn ghost" type="button" onClick={() => void preview()} disabled={loading}>{loading ? "Refreshing authorization…" : snapshot ? "Refresh authorization" : "Preview readiness"}</button>{error && <p role="alert">{error}</p>}{snapshot && <><div className="grid" aria-label="Campaign configuration review"><div><strong>{snapshot.campaign.name}</strong><span className="muted"> campaign</span><p className="muted">Status: {snapshot.campaign.status}</p></div><div><strong>{snapshot.agent.name}</strong><span className="muted"> assigned AI agent</span><p className="muted">{snapshot.agent.language}</p></div><div><strong>{snapshot.campaign.start_hour ?? "—"}:00–{snapshot.campaign.end_hour ?? "—"}:00</strong><span className="muted"> {snapshot.campaign.timezone ?? "timezone unavailable"}</span></div></div><fieldset style={{ marginTop: 10 }}><legend className="label">Select contacts for this offline preview</legend>{snapshot.contacts.length === 0 ? <p className="muted">No tenant-authorized contacts are available.</p> : snapshot.contacts.map((contact) => <label className="label" key={contact.id}><input type="checkbox" checked={selectedIds.has(contact.id)} onChange={() => toggle(contact.id)} /> {contact.name}</label>)}</fieldset>{readiness && <div role="status" style={{ marginTop: 10 }}><p><strong>{readiness.ready ? "Ready for offline simulation" : "Not ready for offline simulation"}</strong></p><div className="grid"><div><strong>{readiness.counts.total}</strong><span className="muted"> total contacts</span></div><div><strong>{readiness.counts.grantedConsent}</strong><span className="muted"> granted consent</span></div><div><strong>{readiness.counts.selected}</strong><span className="muted"> selected</span></div><div><strong>{readiness.counts.eligible}</strong><span className="muted"> eligible</span></div><div><strong>{readiness.counts.unknownConsent}</strong><span className="muted"> unknown consent</span></div><div><strong>{readiness.counts.optedOut}</strong><span className="muted"> opted out/revoked</span></div><div><strong>{readiness.counts.invalid}</strong><span className="muted"> invalid</span></div></div>{readiness.reasons.length > 0 && <ul>{readiness.reasons.map((reason) => <li className="muted" key={reason}>{reason}</li>)}</ul>}</div>}</>}</div>;
}
