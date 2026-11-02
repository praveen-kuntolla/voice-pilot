import type { SimulationPreflight, SimulationPreflightContact } from "@/lib/campaign-simulation";

export type CampaignReadiness = { simulationOnly: true; hypotheticalOrganizationPool: true; ready: boolean; counts: { total: number; eligible: number; unknownConsent: number; optedOut: number; invalid: number }; reasons: string[] };
const reasonFor = (contact: SimulationPreflightContact) => contact.reason?.toLowerCase() ?? "";

export function summarizeCampaignReadiness(snapshot: SimulationPreflight): CampaignReadiness {
  const unknownConsent = snapshot.contacts.filter((contact) => contact.consent_status === "unknown" || reasonFor(contact).includes("unknown consent")).length;
  const optedOut = snapshot.contacts.filter((contact) => contact.opted_out_at !== null || contact.consent_status === "revoked" || reasonFor(contact).includes("opted out") || reasonFor(contact).includes("revoked")).length;
  const invalid = snapshot.contacts.filter((contact) => !contact.eligible && contact.consent_status !== "unknown" && contact.consent_status !== "revoked" && !contact.opted_out_at && !reasonFor(contact).includes("opted out") && !reasonFor(contact).includes("revoked")).length;
  const reasons = [...new Set(snapshot.contacts.filter((contact) => !contact.eligible && contact.reason).map((contact) => contact.reason as string))];
  if (snapshot.contacts.length === 0) reasons.push("No organization contacts are available for this hypothetical pool.");
  if (snapshot.counts.eligible === 0) reasons.push("No eligible contacts are available for simulation.");
  return { simulationOnly: true, hypotheticalOrganizationPool: true, ready: snapshot.counts.eligible > 0, counts: { total: snapshot.contacts.length, eligible: snapshot.counts.eligible, unknownConsent, optedOut, invalid }, reasons: [...new Set(reasons)] };
}
