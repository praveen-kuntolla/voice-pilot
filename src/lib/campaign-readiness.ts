import type { SimulationPreflight, SimulationPreflightContact } from "@/lib/campaign-simulation";

export type CampaignReadiness = { simulationOnly: true; hypotheticalOrganizationPool: true; ready: boolean; counts: { selected: number; total: number; grantedConsent: number; eligible: number; unknownConsent: number; optedOut: number; invalid: number }; reasons: string[] };
const reasonFor = (contact: SimulationPreflightContact) => contact.reason?.toLowerCase() ?? "";

export function summarizeCampaignReadiness(snapshot: SimulationPreflight, selectedIds?: ReadonlySet<string>): CampaignReadiness {
  const contacts = selectedIds ? snapshot.contacts.filter((contact) => selectedIds.has(contact.id)) : snapshot.contacts;
  const unknownConsent = contacts.filter((contact) => contact.consent_status === "unknown" || reasonFor(contact).includes("unknown consent")).length;
  const optedOut = contacts.filter((contact) => contact.opted_out_at !== null || contact.consent_status === "revoked" || reasonFor(contact).includes("opted out") || reasonFor(contact).includes("revoked")).length;
  const invalid = contacts.filter((contact) => !contact.eligible && contact.consent_status !== "unknown" && contact.consent_status !== "revoked" && !contact.opted_out_at && !reasonFor(contact).includes("opted out") && !reasonFor(contact).includes("revoked")).length;
  const reasons = [...new Set(contacts.filter((contact) => !contact.eligible && contact.reason).map((contact) => contact.reason as string))];
  if (contacts.length === 0) reasons.push("No contacts are selected for this hypothetical pool.");
  if (contacts.filter((contact) => contact.eligible).length === 0) reasons.push("No eligible contacts are available for simulation.");
  return { simulationOnly: true, hypotheticalOrganizationPool: true, ready: contacts.some((contact) => contact.eligible), counts: { selected: contacts.length, total: snapshot.contacts.length, grantedConsent: snapshot.contacts.filter((contact) => contact.consent_status === "granted" && !contact.opted_out_at).length, eligible: contacts.filter((contact) => contact.eligible).length, unknownConsent, optedOut, invalid }, reasons: [...new Set(reasons)] };
}
