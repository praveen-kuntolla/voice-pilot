import { describe, expect, it } from "vitest";
import { OfflineWorkerLeaseLifecycle, type WorkerTerminationEvidence } from "@/lib/worker-lease-lifecycle";

const base = { leaseId: "lease-1", organizationId: "org-1", actorId: "actor-1", workerKeyId: "key-a", generation: 7, expiresAt: 2_000 };
const lifecycle = () => new OfflineWorkerLeaseLifecycle(base);
const terminated = (overrides: Partial<WorkerTerminationEvidence> = {}): WorkerTerminationEvidence => ({ source: "trusted_reconciler", kind: "provider_terminated", leaseId: base.leaseId, generation: base.generation, observedAt: 2_100, ...overrides } as WorkerTerminationEvidence);

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
    expect(subject.reconcile(2_100, { ...terminated(), source: "worker", kind: "asserted" })).toEqual({ ok: false, reason: "reconciliation_required" });
    expect(subject.snapshot().state).toBe("reconciliation_required");
    expect(subject.snapshot().state).not.toBe("released");
  });

  it("releases only after confirmed termination and makes reconciliation idempotent", () => {
    const subject = lifecycle();
    expect(subject.requestCancellation(1_000)).toMatchObject({ ok: true });
    expect(subject.reportTermination(terminated())).toMatchObject({ ok: true });
    expect(subject.release("key-a", 7, 1_000)).toMatchObject({ ok: true, lease: { state: "released" } });
    expect(subject.reconcile(2_100, terminated())).toMatchObject({ ok: true, idempotent: true });
  });

  it("rolls back a requested transition when durable audit evidence is unavailable", () => {
    const subject = lifecycle(); subject.setAuditAvailable(false);
    expect(subject.requestCancellation(1_000)).toEqual({ ok: false, reason: "audit_unavailable" });
    expect(subject.snapshot()).toMatchObject({ state: "active", version: 1 });
  });

  it("does not change reconciliation state when its required audit evidence cannot persist", () => {
    const subject = lifecycle(); subject.setAuditAvailable(false);
    expect(subject.reconcile(2_100, { ...terminated(), source: "worker", kind: "asserted" })).toEqual({ ok: false, reason: "audit_unavailable" });
    expect(subject.snapshot()).toMatchObject({ state: "active", version: 1 });
  });

  it("keeps terminal release idempotent after expiry or credential revocation, but rejects stale workers", () => {
    const subject = lifecycle();
    subject.requestCancellation(1_000); subject.reportTermination(terminated());
    expect(subject.release("key-a", 7, 1_000)).toMatchObject({ ok: true });
    subject.revokeKey("key-a");
    expect(subject.release("key-a", 7, 2_100)).toMatchObject({ ok: true, idempotent: true });
    expect(subject.release("key-b", 7, 2_100)).toEqual({ ok: false, reason: "stale_worker" });
  });

  it("cannot downgrade an already released lease during emergency cancellation", () => {
    const subject = lifecycle();
    subject.requestCancellation(1_000); subject.reportTermination(terminated()); subject.release("key-a", 7, 1_000);
    expect(subject.requestCancellation(1_500, true)).toMatchObject({ ok: true, idempotent: true, lease: { state: "released" } });
  });

  it("rejects untrusted or mismatched termination assertions without authorizing release", () => {
    const subject = lifecycle();
    expect(subject.reportTermination({ ...terminated(), source: "worker", kind: "asserted" })).toEqual({ ok: false, reason: "termination_unconfirmed" });
    expect(subject.snapshot().terminationConfirmed).toBe(false);
    expect(subject.reportTermination({ ...terminated(), generation: 8 })).toEqual({ ok: false, reason: "stale_worker" });
  });
});
