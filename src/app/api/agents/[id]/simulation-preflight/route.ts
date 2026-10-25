import { NextResponse } from "next/server";
import { currentMembership } from "@/lib/authz";
import { ProviderGovernanceRepository, GovernancePolicyUnavailable } from "@/lib/provider-governance";
import { evaluateMockSimulationPreflight } from "@/lib/simulation-preflight";
import { z } from "zod";

type Context = { params: Promise<{ id: string }> };

/** Read-only, mock-only gate. It never reserves usage or contacts a provider. */
export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid agent id" }, { status: 400 });
  const { s, user, membership } = await currentMembership();
  if (!user || !membership) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: agent, error } = await s.from("agents")
    .select("id,organization_id,name,instructions,language,status")
    .eq("id", id).eq("organization_id", membership.organization_id).maybeSingle();
  if (error) return NextResponse.json({ error: "Agent lookup unavailable" }, { status: 503 });
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  try {
    const policy = await new ProviderGovernanceRepository(s).loadSnapshot(membership.organization_id, id);
    return NextResponse.json({
      ...evaluateMockSimulationPreflight({ agent, organizationId: membership.organization_id, policy }),
      agentId: id,
      organizationId: membership.organization_id,
    });
  } catch (cause) {
    if (cause instanceof GovernancePolicyUnavailable) return NextResponse.json({ error: "Governance policy unavailable" }, { status: 503 });
    return NextResponse.json({ error: "Simulation preflight unavailable" }, { status: 500 });
  }
}
