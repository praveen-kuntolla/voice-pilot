import { describe, expect, it, vi } from "vitest";
import { authorizeTrustedActor, type TrustedIdentitySource } from "@/lib/trusted-authorization";
import { executePrivilegedSafetyOperation, type SafetyTransactionExecutor } from "@/lib/privileged-safety-gateway";

const actor = "11111111-1111-4111-8111-111111111111";
const org = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";
const now = 10_000;
const source = (role: "owner" | "admin" | "member" | "viewer" = "owner"): TrustedIdentitySource => ({
  getVerifiedIdentity: async () => ({ id: actor, expiresAt: now + 1_000 }),
  getMembership: async (userId, organizationId) => organizationId === org ? { userId, organizationId, role } : null,
});
describe("trusted authorization gateway", () => {
  it("derives the actor from verified identity and enforces the authoritative membership", async () => {
    await expect(authorizeTrustedActor(source(), { organizationId: org, operation: "execute_privileged" }, now)).resolves.toMatchObject({ ok: true, actorId: actor, organizationId: org });
    await expect(authorizeTrustedActor(source(), { organizationId: other, operation: "view" }, now)).resolves.toEqual({ ok: false, reason: "membership_not_found" });
  });

  it("rejects anonymous, expired, revoked, spoofed and unavailable identities", async () => {
    const membership = async () => ({ userId: actor, organizationId: org, role: "owner" as const });
    for (const [identity, reason] of [
      [null, "unauthenticated"],
      [{ id: actor, expiresAt: now }, "session_expired"],
      [{ id: actor, expiresAt: now + 1_000, revoked: true }, "session_revoked"],
    ] as const) {
      await expect(authorizeTrustedActor({ getVerifiedIdentity: async () => identity, getMembership: membership }, { organizationId: org, operation: "view" }, now)).resolves.toEqual({ ok: false, reason });
    }
    await expect(authorizeTrustedActor(source(), { organizationId: org, operation: "view", claimedActorId: other }, now)).resolves.toEqual({ ok: false, reason: "spoofed_actor" });
    await expect(authorizeTrustedActor({ getVerifiedIdentity: async () => ({ id: actor, expiresAt: now + 1_000 }), getMembership: async () => { throw new Error("offline"); } }, { organizationId: org, operation: "view" }, now)).resolves.toEqual({ ok: false, reason: "membership_unavailable" });
  });

  it("implements distinct owner, admin, member and viewer permissions", async () => {
    for (const role of ["owner", "admin"] as const) expect((await authorizeTrustedActor(source(role), { organizationId: org, operation: "manage_safety" }, now)).ok).toBe(true);
    expect((await authorizeTrustedActor(source("member"), { organizationId: org, operation: "simulate" }, now)).ok).toBe(true);
    expect(await authorizeTrustedActor(source("member"), { organizationId: org, operation: "manage_safety" }, now)).toEqual({ ok: false, reason: "role_not_permitted" });
    expect((await authorizeTrustedActor(source("viewer"), { organizationId: org, operation: "view" }, now)).ok).toBe(true);
    expect(await authorizeTrustedActor(source("viewer"), { organizationId: org, operation: "simulate" }, now)).toEqual({ ok: false, reason: "role_not_permitted" });
  });

  it("binds verified request context inside a transaction and never accepts arbitrary SQL", async () => {
    const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
    const query = (async (sql: string, values: readonly unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("provider_global_stop")) return { rows: [{ emergency_stop: false }] };
      if (sql.includes("provider_safety_controls")) return { rows: [{ emergency_stop: false }] };
      return { rows: [{}] };
    }) as unknown as import("@/lib/postgres-durable-safety").SafetyQuery;
    const executor: SafetyTransactionExecutor = { transaction: async (work) => work(query) };
    const result = await executePrivilegedSafetyOperation({ identity: source(), executor, now: () => now }, { kind: "read_controls", organizationId: org });
    expect(result.status).toBe("success");
    expect(calls[0]).toEqual(expect.objectContaining({ values: [actor, org] }));
    expect(calls[0].sql).toContain("set_config");
  });

  it("blocks direct provider-action mutations before opening a privileged transaction", async () => {
    const executor = { transaction: vi.fn() } as unknown as SafetyTransactionExecutor;
    const result = await executePrivilegedSafetyOperation({ identity: source(), executor, now: () => now }, { kind: "reserve", organizationId: org, now, request: { organizationId: other, provider: "mock", idempotencyKey: "key", maxConcurrent: 1, expiresAt: now + 1_000 } });
    expect(result).toEqual({ status: "denied", reason: "composed_policy_gateway_required" });
    expect(executor.transaction).not.toHaveBeenCalled();
  });

  it("fails closed and relies on transaction rollback when the database fails", async () => {
    const executor: SafetyTransactionExecutor = { transaction: async () => { throw new Error("rollback"); } };
    await expect(executePrivilegedSafetyOperation({ identity: source(), executor, now: () => now }, { kind: "read_controls", organizationId: org })).resolves.toEqual({ status: "unavailable", reason: "transaction_failed" });
  });
});
