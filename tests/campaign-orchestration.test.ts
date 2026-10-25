import { describe, expect, it } from "vitest";
import { buildRetryPreview, MockCampaignOrchestrator, validateOrchestrationSchedule } from "@/lib/campaign-orchestration";
import type { SimContact } from "@/lib/campaign-simulation";

const campaign = { id: "campaign", organization_id: "org-a", agent_id: "agent", status: "draft", consent_required: true } as const;
const contacts = [
  { id: "a", name: "A", organization_id: "org-a", consent_status: "granted" },
  { id: "b", name: "B", organization_id: "org-b", consent_status: "granted" },
  { id: "c", name: "C", organization_id: "org-a", consent_status: "revoked" },
] satisfies SimContact[];
const threeEligible = ["a", "b", "d"].map((id) => ({ id, name: id, organization_id: "org-a", consent_status: "granted" as const })) satisfies SimContact[];

describe("mock campaign orchestration", () => {
  it("enforces tenant and consent eligibility with idempotent processing", () => {
    const runner = new MockCampaignOrchestrator(campaign, contacts, "org-a");
    expect(runner.eligible().map((contact) => contact.id)).toEqual(["a"]);
    expect(runner.start()).toBe(true); expect(runner.start()).toBe(false);
    expect(runner.process("b")).toBe(false); expect(runner.process("a")).toBe(true); expect(runner.process("a")).toBe(false);
    expect(runner.summary()).toMatchObject({ eligible: 1, processed: 1, remaining: 0, excluded: 2 });
  });
  it("supports pause, resume, reset and retry previews without executing retries", () => {
    const runner = new MockCampaignOrchestrator(campaign, contacts, "org-a"); runner.start(); expect(runner.pause()).toBe(true); expect(runner.process("a")).toBe(false); expect(runner.resume()).toBe(true); runner.reset(); expect(runner.state).toBe("idle");
    expect(buildRetryPreview("busy", 2)).toHaveLength(1); expect(buildRetryPreview("interested" as never)).toEqual([]); expect(buildRetryPreview("busy", 4)).toEqual([]);
  });
  it("cannot restart after stop and completes an empty queue", () => { const empty = new MockCampaignOrchestrator(campaign, [], "org-a"); expect(empty.start()).toBe(false); expect(empty.state).toBe("completed"); const runner = new MockCampaignOrchestrator(campaign, contacts, "org-a"); runner.start(); runner.stop(); expect(runner.start()).toBe(false); });
  it("processes each eligible contact exactly once and completes", () => { const runner = new MockCampaignOrchestrator(campaign, threeEligible, "org-a"); expect(runner.summary()).toMatchObject({ processed: 0, remaining: 3 }); expect(runner.start()).toBe(true); expect(runner.nextUnprocessed()?.id).toBe("a"); expect(runner.process("a")).toBe(true); expect(runner.summary()).toMatchObject({ processed: 1, remaining: 2 }); expect(runner.nextUnprocessed()?.id).toBe("b"); expect(runner.process("b")).toBe(true); expect(runner.summary()).toMatchObject({ processed: 2, remaining: 1 }); expect(runner.process("a")).toBe(false); expect(runner.process("d")).toBe(true); expect(runner.summary()).toMatchObject({ processed: 3, remaining: 0 }); expect(runner.state).toBe("completed"); });
  it("rejects past schedules", () => { expect(validateOrchestrationSchedule("2020-01-01", "10:00", "Asia/Kolkata", Date.UTC(2025, 0, 1)).ok).toBe(false); });
});
