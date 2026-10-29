import { redirect } from "next/navigation";
import SyntheticActivityDashboard from "@/components/synthetic-activity-dashboard";
import { currentMembership } from "@/lib/authz";

export default async function CallsPage() {
  const { user, membership } = await currentMembership();
  if (!user) redirect("/login?next=/dashboard/calls");
  if (!membership) redirect("/onboarding");
  return <SyntheticActivityDashboard view="calls" organizationId={membership.organization_id} />;
}
