import { describe, expect, it } from "vitest";
import { MemoryDurableSafetyStore } from "@/lib/durable-safety";
import { authorizeProviderAction, type AuthoritativePolicyContext, type PolicyContextRepository } from "@/lib/policy-enforcement-gateway";
import type { TrustedIdentitySource } from "@/lib/trusted-authorization";

const actor = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const now = Date.UTC(2026, 0, 5, 12);
const identity: TrustedIdentitySource = {
  getVerifiedIdentity: async () => ({ id: actor, expiresAt: now + 60_000 }),
  getMembership: async (userId, organizationId) => ({ userId, organizationId, role: "owner" }),
};
const context: AuthoritativePolicyContext = {
  organizationId: org,
  campaign: { id: "campaign", organization_id: org, agent_id: "agent", status: "draft", consent_required: true },
  contact: { id: "contact", name: "Synthetic", organization_id: org, consent_status: "granted", opted_out_at: null },
  agent: { id: "agent", organization_id: org, enabled: true },
  provider: "offline",
  limits: { maxConcurrent: 2, currentConcurrent: 0, maxAttempts: 2, attempt: 0, maxSpendCents: 100, spentCents: 0, emergencyStop: false },
  callingHours: { timeZone: "UTC", startHour: 9, endHour: 17 },
  maxPerMinute: 5,
  estimatedCostCents: 10,
};
const request = { organizationId: org, campaignId: "campaign", agentId: "agent", contactId: "contact", idempotencyKey: "one" };

function harness(overrides: Partial<AuthoritativePolicyContext> = {}) {
  const safety = new MemoryDurableSafetyStore(); safety.setGlobalControl({ emergencyStop: false }); safety.setControl({ organizationId: org, emergencyStop: false });
  const repository: PolicyContextRepository = { load: async () => ({ ...context, ...overrides }), claimRateLimit: async () => true };
  return { identity, safety, repository, now: () => now };
}

describe("consolidated policy enforcement gateway", () => {
  it("accepts only a complete, authoritative, tenant-bound offline policy context", async () => {
    await expect(authorizeProviderAction(harness(), request)).resolves.toMatchObject({ ok: true, actorId: actor, checkedAt: now });
  });

  it("rejects cross-tenant resources, disabled agents and spoofed actors", async () => {
    await expect(authorizeProviderAction(harness({ contact: { ...context.contact, organization_id: "other" } }), request)).resolves.toMatchObject({ ok: false, reason: "resource_authorization_failed" });
    await expect(authorizeProviderAction(harness({ agent: { ...context.agent, enabled: false } }), request)).resolves.toMatchObject({ ok: false, reason: "resource_authorization_failed" });
    await expect(authorizeProviderAction(harness(), { ...request, claimedActorId: "spoofed" })).resolves.toMatchObject({ ok: false, reason: "spoofed_actor" });
  });

  it("fails closed for missing stops, active stops and database failures", async () => {
    const missing = harness(); missing.safety = new MemoryDurableSafetyStore();
    await expect(authorizeProviderAction(missing, request)).resolves.toMatchObject({ ok: false, reason: "required_control_missing" });
    const stopped = harness(); stopped.safety.setGlobalControl({ emergencyStop: true });
    await expect(authorizeProviderAction(stopped, request)).resolves.toMatchObject({ ok: false, reason: "emergency_stop" });
    const failed = harness(); failed.repository.load = async () => { throw new Error("offline"); };
    await expect(authorizeProviderAction(failed, request)).resolves.toMatchObject({ ok: false, reason: "policy_context_unavailable" });
    const controls = harness(); controls.safety.getGlobalControl = async () => { throw new Error("offline"); };
    await expect(authorizeProviderAction(controls, request)).resolves.toMatchObject({ ok: false, category: "unavailable", reason: "safety_control_unavailable" });
  });

  it("rejects missing/revoked consent, opt-out, invalid zones and calling-hour boundaries", async () => {
    for (const contact of [
      { ...context.contact, consent_status: "unknown" as const },
      { ...context.contact, consent_status: "revoked" as const },
      { ...context.contact, opted_out_at: "2026-01-01" },
    ]) await expect(authorizeProviderAction(harness({ contact }), request)).resolves.toMatchObject({ ok: false, category: "safety_blocked" });
    await expect(authorizeProviderAction(harness({ callingHours: { ...context.callingHours, timeZone: "Invalid/Zone" } }), request)).resolves.toMatchObject({ ok: false, category: "safety_blocked" });
    await expect(authorizeProviderAction(harness({ callingHours: { ...context.callingHours, startHour: 13, endHour: 17 } }), request)).resolves.toMatchObject({ ok: false, category: "safety_blocked" });
  });

  it("enforces rate limits and duplicate idempotency keys", async () => {
    const rate = harness(); rate.repository.claimRateLimit = async () => false;
    await expect(authorizeProviderAction(rate, request)).resolves.toMatchObject({ ok: false, reason: "rate_limit_reached" });
    const duplicate = harness(); expect((await authorizeProviderAction(duplicate, request)).ok).toBe(true);
    await expect(authorizeProviderAction(duplicate, request)).resolves.toMatchObject({ ok: false, reason: "duplicate_idempotency_key" });
  });

  it("fails closed when policy evaluation or authoritative claims throw", async () => {
    const policy = harness({ callingHours: null as unknown as AuthoritativePolicyContext["callingHours"] });
    await expect(authorizeProviderAction(policy, request)).resolves.toMatchObject({ ok: false });
    const rate = harness(); rate.repository.claimRateLimit = async () => { throw new Error("offline"); };
    await expect(authorizeProviderAction(rate, request)).resolves.toMatchObject({ ok: false, category: "unavailable", reason: "policy_claim_failed" });
    const replay = harness(); replay.safety.claimReplay = async () => { throw new Error("offline"); };
    await expect(authorizeProviderAction(replay, request)).resolves.toMatchObject({ ok: false, category: "unavailable", reason: "policy_claim_failed" });
  });

  it("uses the trusted clock instead of caller timestamps and handles concurrent duplicate claims atomically", async () => {
    const shared = harness();
    const results = await Promise.all([authorizeProviderAction(shared, request), authorizeProviderAction(shared, request)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.reason === "duplicate_idempotency_key")).toHaveLength(1);
  });
});
