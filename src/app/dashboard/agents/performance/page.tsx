import { redirect } from "next/navigation";
import AgentPerformanceDashboard from "@/components/agent-performance-dashboard";
import { currentMembership } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function AgentPerformancePage() {
  const { user, membership, s } = await currentMembership();
  if (!user) redirect("/login?next=/dashboard/agents/performance");
  if (!membership) redirect("/onboarding");
  const result = await s.from("agents").select("id,name,language,voice_id,status").eq("organization_id", membership.organization_id).order("created_at", { ascending: false });
  return <AgentPerformanceDashboard organizationId={membership.organization_id} agents={result.error ? [] : (result.data ?? [])} />;
}
