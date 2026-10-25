import { NextResponse } from "next/server";
import { currentMembership, canWrite } from "@/lib/authz";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";
import { hasSameOrigin } from "@/lib/request-security";
import { z } from "zod";

export async function GET() {
  const { user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canWrite(membership.role)) return NextResponse.json({ error: "Admin required" }, { status: 403 });
  try {
    const db = await createSupabaseServerClient();
    const repo = new ProviderGovernanceRepository(db);
    const policy = await repo.getPrivacyPolicy(membership.organization_id);
    return NextResponse.json({ policy });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const upsertSchema = z.object({
  audio_retention_days: z.number().int().min(0).max(365),
  transcript_retention_days: z.number().int().min(0).max(365),
  consent_required: z.boolean(),
  permitted_regions: z.array(z.string().min(2).max(20)).max(50),
  redact_diagnostics: z.boolean(),
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
    const policy = await repo.upsertPrivacyPolicy({
      organizationId: membership.organization_id,
      audioRetentionDays: parsed.data.audio_retention_days,
      transcriptRetentionDays: parsed.data.transcript_retention_days,
      consentRequired: parsed.data.consent_required,
      permittedRegions: parsed.data.permitted_regions,
      redactDiagnostics: parsed.data.redact_diagnostics,
      updatedBy: user.id,
    });
    return NextResponse.json({ policy });
  } catch (e) {
    if (e instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
