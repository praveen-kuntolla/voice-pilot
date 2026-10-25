import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";
import { auditQuerySchema, filterAuditEvents } from "@/lib/governance-audit";

// GET /api/governance/audit?limit=50
// Audit events are immutable (no INSERT/UPDATE/DELETE from clients).
// Reads via authenticated client — RLS policy provider_audit_admin_select allows admins.
export async function GET(request: Request) {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = auditQuerySchema.safeParse({
    action: params.action || undefined,
    actorId: params.actor_id || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    search: params.search || undefined,
    page: params.page,
    pageSize: params.page_size,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid audit filter" }, { status: 400 });

  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    // The RPC independently scopes the source set to the selected organization.
    // Filtering is intentionally applied only after that authorization boundary.
    const events = await repo.getAuditEvents(membership.organization_id, 200);
    return NextResponse.json(filterAuditEvents(events, parsed.data));
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
