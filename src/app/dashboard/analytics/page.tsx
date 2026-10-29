import { redirect } from "next/navigation";
import SyntheticActivityDashboard from "@/components/synthetic-activity-dashboard";
import { currentMembership } from "@/lib/authz";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { user, membership } = await currentMembership();
  if (!user) redirect("/login?next=/dashboard/analytics");
  if (!membership) redirect("/onboarding");
  return <SyntheticActivityDashboard view="analytics" organizationId={membership.organization_id} />;
}
