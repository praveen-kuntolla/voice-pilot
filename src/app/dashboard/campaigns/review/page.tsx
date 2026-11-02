import Link from "next/link";
import { Suspense } from "react";
import { CampaignReviewClient } from "@/components/campaign-review-client";

export default function CampaignReviewWorkspace() {
  return <main className="main container"><nav aria-label="Campaign workflow" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}><Link className="muted" href="/dashboard/campaigns">Campaign configuration</Link><Link className="muted" href="/dashboard/agents">Agent Builder</Link><Link className="muted" href="/dashboard/contacts">Contacts and consent</Link></nav><div className="section"><div className="eyebrow">Campaign review workspace · OFFLINE ONLY</div><h1>Rehearse a campaign safely</h1><p className="muted">Review the authorized campaign configuration, select a session-local audience, and run bounded synthetic scenarios. No customers are contacted and no campaign run is saved.</p><div className="card"><h2>Run Offline Rehearsal</h2><p className="muted">The existing simulation preflight revalidates tenant, agent and consent authorization before preparation and again before each lifecycle step.</p><Suspense fallback={<p className="muted" role="status">Loading offline rehearsal…</p>}><CampaignReviewClient /></Suspense></div></div></main>;
}
