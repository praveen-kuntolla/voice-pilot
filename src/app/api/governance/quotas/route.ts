import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable, SUPPORTED_PROVIDERS } from "@/lib/provider-governance";
import { hasSameOrigin } from "@/lib/request-security";
import { z } from "zod";

export async function GET() {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });
  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const quotas = await repo.listQuotas(membership.organization_id);
    return NextResponse.json({ quotas, supported_providers: SUPPORTED_PROVIDERS });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const upsertSchema = z.object({
  provider: z.enum(["deepgram", "openai", "elevenlabs"]),
  max_session_estimated_cost: z.number().nonnegative(),
  max_organization_estimated_cost: z.number().nonnegative(),
  max_concurrent_sessions: z.number().int().nonnegative(),
});

export async function PUT(request: Request) {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });

  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });

  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const quota = await repo.upsertQuota({
      organizationId: membership.organization_id,
      provider: parsed.data.provider,
      maxSessionEstimatedCost: parsed.data.max_session_estimated_cost,
      maxOrganizationEstimatedCost: parsed.data.max_organization_estimated_cost,
      maxConcurrentSessions: parsed.data.max_concurrent_sessions,
      updatedBy: user.id,
    });
    return NextResponse.json({ quota });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
