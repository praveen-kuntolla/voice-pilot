import { redirect } from "next/navigation";
import SyntheticActivityDashboard from "@/components/synthetic-activity-dashboard";
import { currentMembership } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { user, membership, s } = await currentMembership();
  if (!user) redirect("/login?next=/dashboard/analytics");
  if (!membership) redirect("/onboarding");
  const [agents, campaigns, contacts, knowledge] = await Promise.all([
    s.from("agents").select("id").eq("organization_id", membership.organization_id),
    s.from("campaigns").select("id,name,status").eq("organization_id", membership.organization_id),
    s.from("contacts").select("id,consent_status,opted_out_at").eq("organization_id", membership.organization_id),
    s.from("knowledge_sources").select("id,status").eq("organization_id", membership.organization_id),
  ]);
  const persistedMetrics = agents && campaigns && contacts && knowledge && !agents.error && !campaigns.error && !contacts.error && !knowledge.error ? {
    agents: agents.data?.length ?? 0,
    campaigns: campaigns.data?.length ?? 0,
    contacts: contacts.data?.length ?? 0,
    knowledge: knowledge.data?.length ?? 0,
    consent: {
      granted: contacts.data?.filter((item) => item.consent_status === "granted" && !item.opted_out_at).length ?? 0,
      unknown: contacts.data?.filter((item) => item.consent_status === "unknown" && !item.opted_out_at).length ?? 0,
      revoked: contacts.data?.filter((item) => item.consent_status === "revoked").length ?? 0,
      optedOut: contacts.data?.filter((item) => Boolean(item.opted_out_at)).length ?? 0,
    },
    campaignStatuses: Object.entries((campaigns.data ?? []).reduce<Record<string, number>>((summary, campaign) => { summary[campaign.status] = (summary[campaign.status] ?? 0) + 1; return summary; }, {})),
  } : null;
  return <SyntheticActivityDashboard view="analytics" organizationId={membership.organization_id} persistedMetrics={persistedMetrics} />;
}
