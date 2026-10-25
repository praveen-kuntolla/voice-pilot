import { NextResponse } from "next/server";
import { currentMembership } from "@/lib/authz";
import { eligibleContacts } from "@/lib/campaign-simulation";
type Context = { params: Promise<{ id: string }> };
export async function GET(_: Request, context: Context) {
  const { id } = await context.params; const { s, user, membership } = await currentMembership();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!membership) return NextResponse.json({ error: "Organization membership required" }, { status: 403 });
  const campaignResult = await s.from("campaigns").select("id,name,status,organization_id,agent_id,consent_required").eq("id", id).eq("organization_id", membership.organization_id).maybeSingle();
  if (campaignResult.error || !campaignResult.data) return NextResponse.json({ error: "Campaign is not available for this organization" }, { status: 404 });
  const campaign = campaignResult.data;
  if (!["draft", "test", "paused"].includes(campaign.status)) return NextResponse.json({ error: "Campaign state does not permit mock simulation" }, { status: 409 });
  if (!campaign.agent_id) return NextResponse.json({ error: "Campaign has no assigned agent" }, { status: 409 });
  const agentResult = await s.from("agents").select("id,name,organization_id,instructions,language,status").eq("id", campaign.agent_id).eq("organization_id", membership.organization_id).maybeSingle();
  if (agentResult.error || !agentResult.data || agentResult.data.status === "archived" || !agentResult.data.instructions?.trim() || !agentResult.data.language?.trim()) return NextResponse.json({ error: "Assigned agent is unavailable or incomplete" }, { status: 409 });
  const agent = agentResult.data;
  const contactsResult = await s.from("contacts").select("id,name,organization_id,consent_status,opted_out_at").eq("organization_id", membership.organization_id);
  if (contactsResult.error) return NextResponse.json({ error: "Unable to verify campaign contacts" }, { status: 503 });
  const contacts = (contactsResult.data ?? []).map((contact) => ({ ...contact, opt_out: Boolean(contact.opted_out_at) }));
  const eligibility = contacts.map((contact) => ({ id: contact.id, name: contact.name, ...eligibleContacts(campaign, contact, agent.organization_id) }));
  return NextResponse.json({ simulationOnly: true, campaign: { id: campaign.id, name: campaign.name, status: campaign.status }, agent: { id: agent.id, name: agent.name, language: agent.language }, contacts: eligibility, counts: { selected: eligibility.length, eligible: eligibility.filter((item) => item.eligible).length, excluded: eligibility.filter((item) => !item.eligible).length } });
}
