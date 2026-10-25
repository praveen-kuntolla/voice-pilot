import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";
import { hasSameOrigin } from "@/lib/request-security";
import { z } from "zod";

const revokeSchema = z.object({
  provider: z.enum(["deepgram", "openai", "elevenlabs"]),
});

export async function POST(request: Request) {
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

  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });

  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const revoked = await repo.revokeOrgApproval(membership.organization_id, parsed.data.provider);
    return NextResponse.json({ revoked });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
