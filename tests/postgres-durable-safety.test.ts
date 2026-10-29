import { describe, expect, it, vi } from "vitest";
import { PostgresDurableSafetyStore, type SafetyQuery } from "@/lib/postgres-durable-safety";

const org = "11111111-1111-4111-8111-111111111111";
const request = { organizationId: org, provider: "mock", idempotencyKey: "one", maxConcurrent: 1, expiresAt: 4_000 };
describe("server-only PostgreSQL safety adapter", () => {
  it("binds parameters and never interpolates tenant input into SQL", async () => {
    const query = vi.fn(async () => ({ rows: [{ result: { ok: true, reservationId: "22222222-2222-4222-8222-222222222222", reused: false } }] })) as unknown as SafetyQuery;
    const store = new PostgresDurableSafetyStore(query);
    expect(await store.reserve({ ...request, idempotencyKey: "test'; drop table x;--" }, 1)).toMatchObject({ ok: true });
    const [sql, values] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("$3::text");
    expect(sql).not.toContain("drop table");
    expect(values[2]).toBe("test'; drop table x;--");
  });
  it("fails closed on database interruption and missing controls", async () => {
    const query = vi.fn(async () => { throw new Error("database unavailable"); }) as unknown as SafetyQuery;
    const store = new PostgresDurableSafetyStore(query);
    expect(await store.claimReplay({ organizationId: org, provider: "mock", eventId: "e", expiresAt: 4_000 }, 1)).toBe(false);
    expect(await store.getControl(org)).toBeUndefined();
    expect(await store.getGlobalControl()).toBeUndefined();
    expect(await store.reserve(request, 1)).toEqual({ ok: false, error: "unavailable" });
    expect(await store.recordUsage({ organizationId: org, idempotencyKey: "u", amountCents: 1, budgetCents: 2 }, 1)).toEqual({ ok: false, error: "unavailable" });
    expect(await store.reserveUsage({ organizationId: org, idempotencyKey: "u", amountCents: 1, budgetCents: 2, expiresAt: 4_000 }, 1)).toEqual({ ok: false, error: "unavailable" });
    expect(await store.reserveRetryAttempt({ organizationId:org,campaignId:"22222222-2222-4222-8222-222222222222",contactId:"33333333-3333-4333-8333-333333333333",agentId:"44444444-4444-4444-8444-444444444444",provider:"mock",idempotencyKey:"retry",attemptKind:"retry",maxAttempts:2,expiresAt:4_000 },1)).toEqual({ok:false,error:"unavailable"});
  });
  it("returns explicit true and false control values and treats absent rows as unavailable", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ emergency_stop: true }] })
      .mockResolvedValueOnce({ rows: [{ emergency_stop: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const store = new PostgresDurableSafetyStore(query as unknown as SafetyQuery);
    expect(await store.getControl(org)).toEqual({ organizationId: org, emergencyStop: true });
    expect(await store.getGlobalControl()).toEqual({ emergencyStop: false });
    expect(await store.getControl(org)).toBeUndefined();
  });
  it("rejects malformed identities and unsafe monetary values before querying", async () => {
    const query = vi.fn(async () => ({ rows: [] })) as unknown as SafetyQuery;
    const store = new PostgresDurableSafetyStore(query);
    expect(await store.reserve({ ...request, organizationId: "other" }, 1)).toMatchObject({ ok: false, error: "invalid" });
    expect(await store.recordUsage({ organizationId: org, idempotencyKey: "u", amountCents: Number.MAX_SAFE_INTEGER + 1, budgetCents: 5 }, 1)).toMatchObject({ ok: false, error: "invalid" });
    expect(query).not.toHaveBeenCalled();
  });
});
