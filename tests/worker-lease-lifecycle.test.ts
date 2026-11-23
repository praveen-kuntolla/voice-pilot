import { describe, expect, it } from "vitest";
import { OfflineWorkerLeaseLifecycle } from "@/lib/worker-lease-lifecycle";

const base = { leaseId: "lease-1", organizationId: "org-1", actorId: "actor-1", workerKeyId: "key-a", generation: 7, expiresAt: 2_000 };
const lifecycle = () => new OfflineWorkerLeaseLifecycle(base);

describe("offline worker lease lifecycle acceptance model", () => {
  it("makes duplicate cancellation idempotent and blocks release without termination evidence", () => {
    const subject = lifecycle();
    expect(subject.requestCancellation(1_000)).toMatchObject({ ok: true, lease: { state: "cancellation_requested" } });
    expect(subject.requestCancellation(1_000)).toMatchObject({ ok: true, idempotent: true });
    expect(subject.release("key-a", 7, 1_000)).toEqual({ ok: false, reason: "reconciliation_required" });
  });

  it("fails closed for emergency stop, expired leases, stale workers, and revoked credentials", () => {
    expect(lifecycle().renew("key-a", 7, 3_000, 1_000, true)).toEqual({ ok: false, reason: "emergency_stop" });
    expect(lifecycle().renew("key-a", 6, 3_000, 1_000)).toEqual({ ok: false, reason: "stale_worker" });
    expect(lifecycle().renew("key-a", 7, 3_000, 2_000)).toEqual({ ok: false, reason: "reconciliation_required" });
    const subject = lifecycle(); subject.revokeKey("key-a");
    expect(subject.renew("key-a", 7, 3_000, 1_000)).toEqual({ ok: false, reason: "revoked_key" });
  });

  it("does not release capacity on worker crash or unconfirmed provider termination", () => {
    const subject = lifecycle();
    expect(subject.reconcile(2_100, false)).toEqual({ ok: false, reason: "reconciliation_required" });
    expect(subject.snapshot().state).toBe("reconciliation_required");
    expect(subject.snapshot().state).not.toBe("released");
  });

  it("releases only after confirmed termination and makes reconciliation idempotent", () => {
    const subject = lifecycle();
    expect(subject.requestCancellation(1_000)).toMatchObject({ ok: true });
    expect(subject.reportTermination(true)).toMatchObject({ ok: true });
    expect(subject.release("key-a", 7, 1_000)).toMatchObject({ ok: true, lease: { state: "released" } });
    expect(subject.reconcile(2_100, true)).toMatchObject({ ok: true, idempotent: true });
  });

  it("rolls back a requested transition when durable audit evidence is unavailable", () => {
    const subject = lifecycle(); subject.setAuditAvailable(false);
    expect(subject.requestCancellation(1_000)).toEqual({ ok: false, reason: "audit_unavailable" });
    expect(subject.snapshot()).toMatchObject({ state: "active", version: 1 });
  });
});
