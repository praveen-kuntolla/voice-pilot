import { describe, expect, it, vi } from "vitest";
import { prepareOfflineProviderAction, type SafetyTransactionExecutor } from "@/lib/privileged-safety-gateway";
import type { SafetyQuery } from "@/lib/postgres-durable-safety";
import type { AuthoritativePolicyContext, PolicyContextRepository } from "@/lib/policy-enforcement-gateway";
import type { TrustedIdentitySource } from "@/lib/trusted-authorization";
import { MemoryGatewayEventSink } from "@/lib/gateway-observability";

const actor = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const campaign="55555555-5555-4555-8555-555555555555",agent="66666666-6666-4666-8666-666666666666",contact="77777777-7777-4777-8777-777777777777";
const now = Date.UTC(2026, 0, 5, 12);
const input = { kind: "reserve" as const, organizationId: org, campaignId: campaign, agentId: agent, contactId: contact, idempotencyKey: "action-one" };
const context: AuthoritativePolicyContext = {
  organizationId: org,
  campaign: { id: campaign, organization_id: org, agent_id: agent, status: "draft", consent_required: true },
  contact: { id: contact, name: "Synthetic", organization_id: org, consent_status: "granted", opted_out_at: null },
  agent: { id: agent, organization_id: org, enabled: true },
  provider: "offline",
  limits: { maxConcurrent: 2, currentConcurrent: 0, maxAttempts: 2, attempt: 0, maxSpendCents: 100, spentCents: 0, emergencyStop: false },
  callingHours: { timeZone: "UTC", startHour: 9, endHour: 17 },
  maxPerMinute: 5,
  estimatedCostCents: 10,
};
const identity: TrustedIdentitySource = {
  getVerifiedIdentity: async () => ({ id: actor, expiresAt: now + 60_000 }),
  getMembership: async (userId, organizationId) => organizationId === org ? { userId, organizationId, role: "owner" } : null,
};

function harness(overrides: Partial<AuthoritativePolicyContext> = {}, options: { replay?: boolean; failControls?: boolean; failTransaction?: boolean } = {}) {
  const calls: string[] = [];
  const query = (async (sql: string) => {
    calls.push(sql);
    if (options.failControls && sql.includes("provider_global_stop")) throw new Error("database unavailable");
    if (sql.includes("provider_global_stop") || sql.includes("provider_safety_controls")) return { rows: [{ emergency_stop: false }] };
    if (sql.includes("claim_replay")) return { rows: [{ result: options.replay ?? true }] };
    if (sql.includes("reserve_action")) return { rows: [{ result: { ok: true, reservationId: "33333333-3333-4333-8333-333333333333", reused: false } }] };
    if (sql.includes("reserve_retry_attempt")) return { rows: [{ result: { ok: true, attemptId: "44444444-4444-4444-8444-444444444444", attemptNumber: 1, reused: false } }] };
    if (sql.includes("reserve_usage")) return { rows: [{ result: { ok: true, reused: false } }] };
    if (sql.includes("record_usage")) return { rows: [{ result: { ok: true, recorded: true, totalCents: 10 } }] };
    return { rows: [{}] };
  }) as unknown as SafetyQuery;
  const repository: PolicyContextRepository = { load: async () => ({ ...context, ...overrides }), claimRateLimit: async () => true };
  const executor: SafetyTransactionExecutor = { transaction: options.failTransaction ? async () => { throw new Error("rollback"); } : async (work) => work(query) };
  const deps = { identity, executor, createPolicyRepository: () => repository, now: () => now, reservationTtlMs: 60_000 };
  return { calls, deps };
}

describe("privileged provider-action composition", () => {
  it("denies absent/revoked consent, opt-out and calling-hours failures before privileged execution", async () => {
    for (const overrides of [
      { contact: { ...context.contact, consent_status: "unknown" as const } },
      { contact: { ...context.contact, consent_status: "revoked" as const } },
      { contact: { ...context.contact, opted_out_at: "2026-01-01" } },
      { callingHours: { ...context.callingHours, startHour: 13, endHour: 17 } },
    ]) {
      const { calls, deps } = harness(overrides);
      await expect(prepareOfflineProviderAction(deps, input)).resolves.toMatchObject({ status: "safety_blocked" });
      expect(calls.some((sql) => sql.includes("reserve_action") || sql.includes("record_usage"))).toBe(false);
    }
  });

  it("denies unauthorized organizations and spoofed actors before privileged execution", async () => {
    const first = harness();
    await expect(prepareOfflineProviderAction(first.deps, { ...input, organizationId: "other" })).resolves.toMatchObject({ status: "denied" });
    expect(first.calls.some((sql) => sql.includes("reserve_action"))).toBe(false);
    const second = harness();
    await expect(prepareOfflineProviderAction(second.deps, { ...input, claimedActorId: "spoofed" })).resolves.toMatchObject({ status: "denied", reason: "spoofed_actor" });
    expect(second.calls.some((sql) => sql.includes("reserve_action"))).toBe(false);
  });

  it("returns unavailable for failed control reads and rejects duplicate idempotency claims", async () => {
    const failed = harness({}, { failControls: true });
    await expect(prepareOfflineProviderAction(failed.deps, input)).resolves.toEqual({ status: "unavailable", reason: "required_control_missing" });
    expect(failed.calls.some((sql) => sql.includes("reserve_action"))).toBe(false);
    const duplicate = harness({}, { replay: false });
    await expect(prepareOfflineProviderAction(duplicate.deps, input)).resolves.toMatchObject({ status: "safety_blocked", reason: "duplicate_idempotency_key" });
    expect(duplicate.calls.some((sql) => sql.includes("reserve_action"))).toBe(false);
  });

  it("emits sanitized denial telemetry without request secrets", async () => {
    const duplicate = harness({}, { replay: false }); const observer = new MemoryGatewayEventSink();
    await prepareOfflineProviderAction({ ...duplicate.deps, observer, correlationId: "corr-safe" }, { ...input, idempotencyKey: "private-key" });
    expect(observer.events).toEqual([expect.objectContaining({ type: "duplicate_idempotency", correlationId: "corr-safe" })]);
    expect(JSON.stringify(observer.events)).not.toContain("private-key");
  });

  it("fails closed when a safety-critical denial audit cannot be recorded",async()=>{const duplicate=harness({}, {replay:false});await expect(prepareOfflineProviderAction({...duplicate.deps,observer:{emit:async()=>{throw new Error("sink offline");}}},input)).rejects.toThrow("sink offline");});

  it("uses trusted time and authoritative limits for offline preparation without dispatching an external job", async () => {
    const { calls, deps } = harness();
    const result = await prepareOfflineProviderAction(deps, input);
    expect(result).toMatchObject({ status: "success", value: { prepared: true, simulationOnly: true } });
    expect(calls.some((sql) => sql.includes("reserve_action"))).toBe(true);
    expect(calls.some((sql) => sql.includes("reserve_usage"))).toBe(true);
    expect(calls.findIndex((sql) => sql.includes("set_config('request.jwt.claim.sub'"))).toBeLessThan(calls.findIndex((sql) => sql.includes("provider_global_stop")));
    expect(calls.every((sql) => !/livekit|twilio|telnyx|http/i.test(sql))).toBe(true);
  });

  it("uses authoritative cost data for usage and remains fail-closed on transaction failure", async () => {
    const usage = harness();
    await expect(prepareOfflineProviderAction(usage.deps, { ...input, kind: "record_usage" })).resolves.toMatchObject({ status: "success", value: { simulationOnly: true } });
    expect(usage.calls.some((sql) => sql.includes("record_usage"))).toBe(true);
    const failed = harness({}, { failTransaction: true });
    await expect(prepareOfflineProviderAction(failed.deps, input)).resolves.toEqual({ status: "unavailable", reason: "transaction_failed" });
  });
});
