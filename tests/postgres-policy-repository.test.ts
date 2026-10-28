import { describe, expect, it, vi } from "vitest";
import { PostgresPolicyRepository } from "@/lib/postgres-policy-repository";
import type { SafetyQuery } from "@/lib/postgres-durable-safety";

const org = "11111111-1111-4111-8111-111111111111";
const input = { organizationId: org, campaignId: "22222222-2222-4222-8222-222222222222", agentId: "33333333-3333-4333-8333-333333333333", contactId: "44444444-4444-4444-8444-444444444444" };
const row = { organization_id: org, campaign_id: input.campaignId, campaign_status: "test", campaign_agent_id: input.agentId, consent_required: true, timezone: "UTC", start_hour: 9, end_hour: 17, contact_id: input.contactId, contact_name: "Synthetic", consent_status: "granted", opted_out_at: null, agent_id: input.agentId, agent_status: "active", provider: "openai", max_attempts: 2, estimated_action_cents: "10", max_concurrent: 2, max_per_minute: 5, current_concurrent: "0", budget_cents: "100", used_cents: "5", reserved_cents: "5" };

describe("Postgres authoritative policy repository", () => {
  it("maps authoritative rows and parameter-binds all resource identities", async () => {
    const query = vi.fn(async () => ({ rows: [row] })) as unknown as SafetyQuery;
    const result = await new PostgresPolicyRepository(query).load(input);
    expect(result).toMatchObject({ organizationId: org, provider: "openai", limits: { currentConcurrent: 0, spentCents: 10, maxSpendCents: 100 }, estimatedCostCents: 10 });
    const [sql, values] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("current_setting('request.jwt.claim.sub',true)");
    expect(sql).toContain("$4::uuid");
    expect(values).toEqual([org, input.campaignId, input.agentId, input.contactId]);
  });

  it("fails closed for missing policy rows and unsafe accounting values", async () => {
    const missing = vi.fn(async () => ({ rows: [] })) as unknown as SafetyQuery;
    await expect(new PostgresPolicyRepository(missing).load(input)).resolves.toBeNull();
    const unsafe = vi.fn(async () => ({ rows: [{ ...row, used_cents: String(Number.MAX_SAFE_INTEGER), reserved_cents: "1" }] })) as unknown as SafetyQuery;
    await expect(new PostgresPolicyRepository(unsafe).load(input)).resolves.toBeNull();
  });

  it("uses the restricted rate-claim routine", async () => {
    const query = vi.fn(async () => ({ rows: [{ result: true }] })) as unknown as SafetyQuery;
    await expect(new PostgresPolicyRepository(query).claimRateLimit({ organizationId: org, provider: "openai", limit: 5 })).resolves.toBe(true);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("voicepilot_safety.claim_rate");
  });
});
