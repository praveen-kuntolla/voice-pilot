import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";

// GET /api/governance/audit?limit=50
// Audit events are immutable (no INSERT/UPDATE/DELETE from clients).
// Reads via authenticated client — RLS policy provider_audit_admin_select allows admins.
export async function GET(request: Request) {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const limitParam = new URL(request.url).searchParams.get("limit") ?? "50";
  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200);

  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const events = await repo.getAuditEvents(membership.organization_id, limit);
    return NextResponse.json({ events });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
