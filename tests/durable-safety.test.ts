import { describe, expect, it } from "vitest";
import { MemoryDurableSafetyStore } from "@/lib/durable-safety";
const control = { organizationId: "org-a", emergencyStop: false };
const base = { organizationId: "org-a", provider: "mock", idempotencyKey: "request-1", maxConcurrent: 1, expiresAt: 2_000 };
describe("durable safety contracts", () => {
  it("claims tenant-bound replay identities at the exact expiry boundary", async () => { const store = new MemoryDurableSafetyStore(); expect(await store.claimReplay({ organizationId: "org-a", provider: "mock", eventId: "evt", expiresAt: 100 }, 0)).toBe(true); expect(await store.claimReplay({ organizationId: "org-a", provider: "mock", eventId: "evt", expiresAt: 100 }, 99)).toBe(false); expect(await store.claimReplay({ organizationId: "org-a", provider: "mock", eventId: "evt", expiresAt: 200 }, 100)).toBe(true); expect(await store.claimReplay({ organizationId: "org-b", provider: "mock", eventId: "evt", expiresAt: 200 }, 100)).toBe(true); });
  it("requires distinct organization and global controls and honors each emergency stop", async () => {
    const store = new MemoryDurableSafetyStore();
    expect(await store.reserve(base, 1)).toMatchObject({ ok: false, error: "unavailable" });
    store.setControl(control);
    expect(await store.reserve(base, 1)).toMatchObject({ ok: false, error: "unavailable" });
    store.setGlobalControl({ emergencyStop: false });
    expect(await store.reserve(base, 1)).toMatchObject({ ok: true });
    store.setControl({ ...control, emergencyStop: true });
    expect(await store.reserve({ ...base, idempotencyKey: "other" }, 1)).toMatchObject({ ok: false, error: "emergency_stop" });
    store.setControl(control);
    store.setGlobalControl({ emergencyStop: true });
    expect(await store.recordUsage({ organizationId: "org-a", idempotencyKey: "u", amountCents: 1, budgetCents: 2 }, 1)).toMatchObject({ ok: false, error: "emergency_stop" });
  });
  it("enforces idempotent concurrency and release", async () => { const store = new MemoryDurableSafetyStore(); store.setControl(control); store.setGlobalControl({ emergencyStop: false }); const first = await store.reserve(base, 1); expect(first).toMatchObject({ ok: true, reused: false }); expect(await store.reserve(base, 1)).toMatchObject({ ok: true, reused: true }); expect(await store.reserve({ ...base, idempotencyKey: "request-2" }, 1)).toMatchObject({ ok: false, error: "concurrency_limit" }); if (first.ok) expect(await store.release("org-a", "mock", first.reservationId)).toBe(true); expect(await store.reserve({ ...base, idempotencyKey: "request-2" }, 1)).toMatchObject({ ok: true }); });
  it("accounts integer cents once and rejects conflicting idempotency requests", async () => {
    const store = new MemoryDurableSafetyStore(); store.setControl(control); store.setGlobalControl({ emergencyStop: false });
    const first = { organizationId: "org-a", idempotencyKey: "u1", amountCents: 60, budgetCents: 100 };
    expect(await store.recordUsage(first, 1)).toMatchObject({ recorded: true, totalCents: 60 });
    expect(await store.recordUsage(first, 1)).toMatchObject({ recorded: false, totalCents: 60 });
    expect(await store.recordUsage({ ...first, amountCents: 61 }, 1)).toMatchObject({ ok: false, error: "invalid" });
    expect(await store.recordUsage({ ...first, budgetCents: 101 }, 1)).toMatchObject({ ok: false, error: "invalid" });
    expect(await store.recordUsage({ ...first, idempotencyKey: "u2", amountCents: 41 }, 1)).toMatchObject({ ok: false, error: "budget_exceeded" });
    expect(await store.recordUsage({ ...first, organizationId: "org-b" }, 1)).toMatchObject({ ok: false, error: "unavailable" });
  });
  it("rejects invalid and overflowed monetary values without changing totals", async () => {
    const store = new MemoryDurableSafetyStore(); store.setControl(control); store.setGlobalControl({ emergencyStop: false });
    const request = { organizationId: "org-a", idempotencyKey: "max", amountCents: Number.MAX_SAFE_INTEGER, budgetCents: Number.MAX_SAFE_INTEGER };
    expect(await store.recordUsage(request, 1)).toMatchObject({ ok: true, totalCents: Number.MAX_SAFE_INTEGER });
    for (const amountCents of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 1]) {
      expect(await store.recordUsage({ ...request, idempotencyKey: `extra-${amountCents}`, amountCents }, 1)).toMatchObject({ ok: false, error: "invalid" });
    }
    expect(await store.recordUsage(request, 1)).toMatchObject({ recorded: false, totalCents: Number.MAX_SAFE_INTEGER });
    expect(await store.recordUsage({ ...request, budgetCents: -1 }, 1)).toMatchObject({ ok: false, error: "invalid" });
  });
  it("rejects expired incoming replay claims and isolates provider identities", async () => {
    const store = new MemoryDurableSafetyStore(); const claim = { organizationId: "org-a", provider: "mock-a", eventId: "e", expiresAt: 100 };
    expect(await store.claimReplay(claim, 100)).toBe(false);
    expect(await store.claimReplay(claim, 101)).toBe(false);
    expect(await store.claimReplay(claim, 99)).toBe(true);
    expect(await store.claimReplay({ ...claim, provider: "mock-b" }, 99)).toBe(true);
  });
});
