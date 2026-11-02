import { redirect } from "next/navigation";
import OfflineRecoveryDashboard from "@/components/offline-recovery-dashboard";
import { currentMembership } from "@/lib/authz";
export const dynamic = "force-dynamic";
export default async function RecoveryPage() { const { user, membership } = await currentMembership(); if (!user) redirect("/login?next=/dashboard/recovery"); if (!membership) redirect("/onboarding"); return <OfflineRecoveryDashboard />; }
