import { describe, expect, it } from "vitest";
import { MockCampaignSimulation, completedInteractions, eligibleContacts, qualificationForInteraction, qualifySimulation, simulationMetrics } from "@/lib/campaign-simulation";
const org = "org-a";
const campaign = { id: "campaign", organization_id: org, agent_id: "agent", status: "test", consent_required: true };
describe("mock campaign simulation", () => {
  it("excludes unknown, revoked, opted-out and cross-tenant contacts", () => {
    expect(eligibleContacts(campaign, { id: "1", name: "Unknown", organization_id: org, consent_status: "unknown" })).toMatchObject({ eligible: false });
    expect(eligibleContacts(campaign, { id: "2", name: "Other", organization_id: "org-b", consent_status: "granted" })).toMatchObject({ eligible: false });
    expect(eligibleContacts(campaign, { id: "3", name: "Allowed", organization_id: org, consent_status: "granted" }, "org-b")).toMatchObject({ eligible: false });
  });
  it("supports deterministic lifecycle, pause/resume and metrics", () => {
    const simulation = new MockCampaignSimulation(campaign, [{ id: "1", name: "A", organization_id: org, consent_status: "granted" }, { id: "2", name: "B", organization_id: org, consent_status: "revoked" }], org);
    expect(simulation.start("callback_requested")).toBe(true); expect(simulation.state).toBe("running"); expect(simulation.pause()).toBe(true); expect(simulation.resume("callback_requested")).toBe(true); expect(simulation.state).toBe("completed");
    expect(simulationMetrics(simulation.events)).toMatchObject({ total: 2, eligible: 1, skipped: 1, completed: 1, callbackRequested: 1 });
    expect(simulation.start()).toBe(false); simulation.reset(); expect(simulation.state).toBe("idle");
  });
  it("prevents duplicate stop and never creates a real call state", () => {
    const simulation = new MockCampaignSimulation(campaign, [], org); expect(simulation.stop()).toBe(true); expect(simulation.stop()).toBe(false); expect(simulation.events).toHaveLength(0);
  });
  it("always excludes opted-out contacts and blocks restart until reset", () => {
    expect(eligibleContacts(campaign, { id: "4", name: "Opted out", organization_id: org, consent_status: "granted", opted_out_at: "2026-01-01" })).toMatchObject({ eligible: false });
    const simulation = new MockCampaignSimulation(campaign, [{ id: "5", name: "A", organization_id: org, consent_status: "granted" }, { id: "8", name: "B", organization_id: org, consent_status: "granted" }], org);
    expect(simulation.start()).toBe(true);
    expect(simulation.stop()).toBe(true);
    expect(simulation.start()).toBe(false);
    simulation.reset();
    expect(simulation.start()).toBe(true);
  });
  it("reports selected, processed and remaining queue metrics", () => {
    const simulation = new MockCampaignSimulation(campaign, [{ id: "6", name: "A", organization_id: org, consent_status: "granted" }, { id: "7", name: "B", organization_id: org, consent_status: "granted" }], org);
    simulation.start("busy");
    expect(simulationMetrics(simulation.events, simulation.contacts.length)).toMatchObject({ selected: 2, processed: 1, remaining: 1, busy: 1 });
  });
  it("scores deterministic synthetic qualification scenarios with explanations", () => {
    expect(qualifySimulation("interested", { service: "voice", purchase: "yes", budget: "high", timing: "now" })).toMatchObject({ status: "highly_interested", nextAction: "appointment" });
    expect(qualifySimulation("callback_requested", { service: "voice", purchase: "yes" }).explanation.length).toBeGreaterThan(1);
    expect(qualifySimulation("opted_out")).toMatchObject({ status: "do_not_contact", score: 0, nextAction: "none" });
  });
  it("qualifies only a completed interaction and preserves contact linkage", () => {
    const simulation = new MockCampaignSimulation(campaign, [{ id: "qualified", name: "Qualified", organization_id: org, consent_status: "granted" }, { id: "busy", name: "Busy", organization_id: org, consent_status: "granted" }], org);
    expect(qualificationForInteraction(simulation.events, "qualified:0")).toBeNull();
    simulation.start("callback_requested");
    simulation.pause();
    simulation.resume("busy");
    const interactions = completedInteractions(simulation.events);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].contactId).toBe("qualified");
    expect(qualificationForInteraction(simulation.events, interactions[0].id, { service: "voice", purchase: "yes", budget: "medium", timing: "later" })?.result.nextAction).toBe("callback");
    expect(simulationMetrics(simulation.events, 2, { service: "voice", purchase: "yes", budget: "medium", timing: "later" })).toMatchObject({ selected: 2, processed: 2, remaining: 0, qualified: 1, busy: 1 });
  });
  it("does not create duplicate interaction qualifications after reset", () => {
    const simulation = new MockCampaignSimulation(campaign, [{ id: "1", name: "A", organization_id: org, consent_status: "granted" }], org);
    simulation.start("appointment_requested");
    expect(completedInteractions(simulation.events)).toHaveLength(1);
    simulation.reset();
    expect(completedInteractions(simulation.events)).toHaveLength(0);
  });
  it("counts qualified analytics from deterministic results, not outcome labels", () => {
    const simulation = new MockCampaignSimulation(campaign, [{ id: "1", name: "A", organization_id: org, consent_status: "granted" }, { id: "2", name: "B", organization_id: org, consent_status: "granted" }], org);
    simulation.start("interested");
    simulation.pause();
    simulation.resume("no_answer");
    expect(simulationMetrics(simulation.events, 2, { service: "voice", purchase: "yes", budget: "high", timing: "now" })).toMatchObject({ processed: 2, qualified: 1, highlyInterested: 1, noAnswer: 1 });
  });
});
