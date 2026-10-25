export type MockOutcome = "interested" | "not_interested" | "callback_requested" | "appointment_requested" | "no_answer" | "busy" | "wrong_number" | "opted_out" | "error";
export type SimCallState = "queued" | "eligibility_checking" | "simulated_dialing" | "simulated_ringing" | "simulated_connected" | "mock_conversation" | "completed" | "no_answer" | "busy" | "failed" | "skipped" | "cancelled";
export type SimContact = { id: string; name: string; consent_status?: "unknown" | "granted" | "revoked"; opted_out_at?: string | null; opt_out?: boolean; organization_id: string };
export type SimCampaign = { id: string; organization_id: string; agent_id?: string | null; status: string; consent_required: boolean };
export type SimEvent = { contactId: string; state: SimCallState; message: string; outcome?: MockOutcome };

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
  start(scenario: MockOutcome = "interested") {
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
        this.events.push({ contactId: contact.id, state, outcome, message: `Simulation outcome: ${outcome}.` });
      }
      this.index++;
    }
    if (this.state === "running" && this.index >= this.contacts.length) this.state = "completed";
    return true;
  }
  pause() { if (this.state !== "running") return false; this.state = "paused"; return true; }
  resume(scenario: MockOutcome = "interested") { if (this.state !== "paused") return false; return this.start(scenario); }
  stop() { if (this.state === "stopped" || this.state === "completed") return false; this.state = "stopped"; return true; }
  reset() { this.events.length = 0; this.index = 0; this.state = "idle"; }
}

export function simulationMetrics(events: SimEvent[], selectedCount = new Set(events.map((event) => event.contactId)).size) {
  const last = new Map<string, SimEvent>(); events.forEach((event) => last.set(event.contactId, event));
  const values = [...last.values()];
  const processed = values.length;
  return { selected: selectedCount, total: selectedCount, processed, remaining: Math.max(0, selectedCount - processed), eligible: values.filter((x) => x.state !== "skipped").length, skipped: values.filter((x) => x.state === "skipped").length, completed: values.filter((x) => x.state === "completed").length, connected: events.filter((x) => x.state === "simulated_connected").length, noAnswer: values.filter((x) => x.outcome === "no_answer").length, busy: values.filter((x) => x.outcome === "busy").length, failed: values.filter((x) => x.state === "failed").length, interested: values.filter((x) => x.outcome === "interested").length, callbackRequested: values.filter((x) => x.outcome === "callback_requested").length, appointmentRequested: values.filter((x) => x.outcome === "appointment_requested").length };
}
