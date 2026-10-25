import { z } from "zod";

export type MockOutcome = "interested" | "not_interested" | "callback_requested" | "appointment_requested" | "no_answer" | "busy" | "wrong_number" | "opted_out" | "error";
export type SimCallState = "queued" | "eligibility_checking" | "simulated_dialing" | "simulated_ringing" | "simulated_connected" | "mock_conversation" | "completed" | "no_answer" | "busy" | "failed" | "skipped" | "cancelled";
export type SimContact = { id: string; name: string; consent_status?: "unknown" | "granted" | "revoked"; opted_out_at?: string | null; opt_out?: boolean; organization_id: string };
export type SimCampaign = { id: string; organization_id: string; agent_id?: string | null; status: string; consent_required: boolean };
export type QualificationAnswers = { service?: string; purchase?: "yes" | "no" | "maybe"; budget?: "low" | "medium" | "high"; timing?: "now" | "later" };
export type SimEvent = { contactId: string; state: SimCallState; message: string; outcome?: MockOutcome; qualificationAnswers?: QualificationAnswers };
export type SimulationInteraction = { id: string; contactId: string; outcome: MockOutcome; eventIndex: number; qualificationAnswers?: QualificationAnswers };
export type QualificationStatus = "new_lead" | "qualified" | "highly_interested" | "interested" | "needs_follow_up" | "not_interested" | "unqualified" | "do_not_contact";
export type QualificationResult = { score: number; status: QualificationStatus; explanation: string[]; nextAction: "callback" | "appointment" | "follow_up" | "none" };
export function qualifySimulation(outcome: MockOutcome, answers: QualificationAnswers = {}): QualificationResult {
  if (outcome === "opted_out" || outcome === "wrong_number") return { score: 0, status: "do_not_contact", explanation: ["The selected scenario is excluded from outreach."], nextAction: "none" };
  if (outcome === "not_interested") return { score: 15, status: "not_interested", explanation: ["The selected scenario indicates no current interest."], nextAction: "none" };
  let score = 25; const explanation = ["The synthetic scenario starts with a neutral lead score."];
  if (answers.service) { score += 20; explanation.push("A service need was provided."); }
  if (answers.purchase === "yes") { score += 25; explanation.push("Purchase intent was selected."); } else if (answers.purchase === "maybe") { score += 10; explanation.push("Purchase intent was uncertain."); }
  if (answers.budget === "high") { score += 15; explanation.push("A high synthetic budget was selected."); } else if (answers.budget === "medium") { score += 8; explanation.push("A medium synthetic budget was selected."); }
  if (answers.timing === "now") { score += 15; explanation.push("Immediate timing was selected."); } else if (answers.timing === "later") { score += 5; explanation.push("Later timing was selected."); }
  if (score >= 85) return { score, status: "highly_interested", explanation, nextAction: "appointment" };
  if (score >= 65) return { score, status: "qualified", explanation, nextAction: "callback" };
  if (score >= 45) return { score, status: "interested", explanation, nextAction: "follow_up" };
  return { score, status: "needs_follow_up", explanation, nextAction: "follow_up" };
}
const terminalOutcomes = new Set<MockOutcome>(["interested", "not_interested", "callback_requested", "appointment_requested", "opted_out", "wrong_number"]);
export function completedInteractions(events: SimEvent[]): SimulationInteraction[] {
  return events.flatMap((event, eventIndex) => event.state === "completed" && event.outcome && terminalOutcomes.has(event.outcome) ? [{ id: `${event.contactId}:${eventIndex}`, contactId: event.contactId, outcome: event.outcome, eventIndex, qualificationAnswers: event.qualificationAnswers }] : []);
}
export function qualificationForInteraction(events: SimEvent[], interactionId: string) {
  const interaction = completedInteractions(events).find((item) => item.id === interactionId);
  return interaction ? { interaction, result: qualifySimulation(interaction.outcome, interaction.qualificationAnswers) } : null;
}
export type SimulationPreflightContact = { id: string; name: string; organization_id: string; consent_status: "unknown" | "granted" | "revoked"; opted_out_at: string | null; eligible: boolean; reason?: string };
export type SimulationPreflight = { simulationOnly: true; organizationId: string; campaign: SimCampaign & { name: string }; agent: { id: string; name: string; language: string; organization_id: string }; contacts: SimulationPreflightContact[]; counts: { selected: number; eligible: number; excluded: number } };
export const simulationPreflightSchema = z.object({ simulationOnly: z.literal(true), organizationId: z.string().min(1), campaign: z.object({ id: z.string().min(1), name: z.string(), status: z.string(), organization_id: z.string().min(1), agent_id: z.string().nullable(), consent_required: z.boolean() }), agent: z.object({ id: z.string().min(1), name: z.string(), language: z.string(), organization_id: z.string().min(1) }), contacts: z.array(z.object({ id: z.string().min(1), name: z.string(), organization_id: z.string().min(1), consent_status: z.enum(["unknown", "granted", "revoked"]), opted_out_at: z.string().nullable(), eligible: z.boolean(), reason: z.string().optional() })), counts: z.object({ selected: z.number().int().nonnegative(), eligible: z.number().int().nonnegative(), excluded: z.number().int().nonnegative() }) }).strict();

export function eligibleContacts(campaign: SimCampaign, contacts: SimContact, agentOrganizationId?: string) {
  if (campaign.organization_id !== contacts.organization_id) return { eligible: false, reason: "Contact belongs to another organization." };
  if (campaign.status === "archived") return { eligible: false, reason: "Campaign is archived." };
  if (contacts.opt_out || contacts.opted_out_at) return { eligible: false, reason: "Contact has opted out." };
  if (contacts.consent_status === "revoked") return { eligible: false, reason: "Consent was revoked." };
  if (campaign.consent_required && contacts.consent_status !== "granted") return { eligible: false, reason: "Consent is unknown." };
  if (agentOrganizationId && campaign.organization_id !== agentOrganizationId) return { eligible: false, reason: "Assigned agent belongs to another organization." };
  return { eligible: true as const };
}
export function outcomeFor(contactId: string, scenario: MockOutcome = "interested"): MockOutcome { void contactId; return scenario; }

export class MockCampaignSimulation {
  readonly events: SimEvent[] = [];
  state: "idle" | "running" | "paused" | "stopped" | "completed" = "idle";
  private index = 0;
  constructor(readonly campaign: SimCampaign, readonly contacts: SimContact[], readonly agentOrganizationId?: string) {}
  start(scenario: MockOutcome = "interested", answers: QualificationAnswers = {}) {
    if (this.state === "running" || this.state === "completed" || this.state === "stopped") return false;
    this.state = "running";
    if (this.index < this.contacts.length) {
      const contact = this.contacts[this.index];
      this.events.push({ contactId: contact.id, state: "eligibility_checking", message: `Checking ${contact.name}.` });
      const check = eligibleContacts(this.campaign, contact, this.agentOrganizationId);
      if (!check.eligible) this.events.push({ contactId: contact.id, state: "skipped", message: check.reason });
      else {
        this.events.push({ contactId: contact.id, state: "simulated_dialing", message: "Simulated dialing only." }, { contactId: contact.id, state: "simulated_ringing", message: "Simulated ringing only." }, { contactId: contact.id, state: "simulated_connected", message: "Simulated connection; no call was placed." });
        const outcome = outcomeFor(contact.id, scenario);
        const state: SimCallState = outcome === "no_answer" ? "no_answer" : outcome === "busy" ? "busy" : outcome === "error" ? "failed" : "completed";
        this.events.push({ contactId: contact.id, state, outcome, qualificationAnswers: { ...answers }, message: `Simulation outcome: ${outcome}.` });
      }
      this.index++;
    }
    if (this.state === "running" && this.index >= this.contacts.length) this.state = "completed";
    return true;
  }
  pause() { if (this.state !== "running") return false; this.state = "paused"; return true; }
  resume(scenario: MockOutcome = "interested", answers: QualificationAnswers = {}) { if (this.state !== "paused") return false; return this.start(scenario, answers); }
  stop() { if (this.state === "stopped" || this.state === "completed") return false; this.state = "stopped"; return true; }
  reset() { this.events.length = 0; this.index = 0; this.state = "idle"; }
}

export function simulationMetrics(events: SimEvent[], selectedCount = new Set(events.map((event) => event.contactId)).size) {
  const last = new Map<string, SimEvent>(); events.forEach((event) => last.set(event.contactId, event));
  const values = [...last.values()];
  const processed = values.length;
  const interactions = completedInteractions(events);
  const qualificationResults = interactions.map((item) => qualifySimulation(item.outcome, item.qualificationAnswers));
  return { selected: selectedCount, total: selectedCount, processed, remaining: Math.max(0, selectedCount - processed), eligible: values.filter((x) => x.state !== "skipped").length, skipped: values.filter((x) => x.state === "skipped").length, completed: values.filter((x) => x.state === "completed").length, connected: events.filter((x) => x.state === "simulated_connected").length, noAnswer: values.filter((x) => x.outcome === "no_answer").length, busy: values.filter((x) => x.outcome === "busy").length, failed: values.filter((x) => x.state === "failed").length, interested: values.filter((x) => x.outcome === "interested").length, callbackRequested: values.filter((x) => x.outcome === "callback_requested").length, appointmentRequested: values.filter((x) => x.outcome === "appointment_requested").length, qualified: qualificationResults.filter((result) => result.status === "qualified" || result.status === "highly_interested").length, highlyInterested: qualificationResults.filter((result) => result.status === "highly_interested").length };
}

