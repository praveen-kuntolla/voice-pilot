import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";

// GET /api/governance/usage?period_start=YYYY-MM-DD
// The security-definer read RPC independently verifies the selected admin membership.
export async function GET(request: Request) {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const periodStart = new URL(request.url).searchParams.get("period_start") ?? undefined;

  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const summary = await repo.getUsageSummary(membership.organization_id, periodStart);
    return NextResponse.json({ summary, livekit_jwt_revoked: false });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
