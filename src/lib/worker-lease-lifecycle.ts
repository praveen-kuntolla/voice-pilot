/**
 * Offline-only model of the reviewed worker-lease contract. It does not talk
 * to a database, provider, room, microphone, or worker runtime.
 */
export type WorkerLeaseState = "active" | "cancellation_requested" | "termination_unconfirmed" | "reconciliation_required" | "released";

export type WorkerLease = Readonly<{
  leaseId: string;
  organizationId: string;
  actorId: string;
  workerKeyId: string;
  generation: number;
  expiresAt: number;
  state: WorkerLeaseState;
  terminationConfirmed: boolean;
  version: number;
}>;

export type LeaseResult =
  | { ok: true; lease: WorkerLease; idempotent?: boolean }
  | { ok: false; reason: "expired" | "revoked_key" | "stale_worker" | "emergency_stop" | "termination_unconfirmed" | "audit_unavailable" | "reconciliation_required" };

type LeaseFailureReason = Extract<LeaseResult, { ok: false }>['reason'];

/** Only a reconciler-provided provider signal can authorize capacity release. */
export type WorkerTerminationEvidence =
  | { source: "trusted_reconciler"; kind: "provider_terminated"; leaseId: string; generation: number; observedAt: number }
  | { source: "worker" | "caller"; kind: "asserted"; leaseId: string; generation: number; observedAt: number };

export class OfflineWorkerLeaseLifecycle {
  private lease: WorkerLease;
  private readonly revokedKeys = new Set<string>();
  private auditAvailable = true;

  constructor(lease: Omit<WorkerLease, "state" | "terminationConfirmed" | "version">) {
    this.lease = { ...lease, state: "active", terminationConfirmed: false, version: 1 };
  }

  snapshot(): WorkerLease { return this.lease; }
  revokeKey(keyId: string): void { this.revokedKeys.add(keyId); }
  setAuditAvailable(available: boolean): void { this.auditAvailable = available; }

  requestCancellation(now: number, emergencyStop = false): LeaseResult {
    if (this.lease.state === "released") return { ok: true, lease: this.lease, idempotent: true };
    if (emergencyStop) return this.transition(now, "cancellation_requested", false, "emergency_stop");
    if (now >= this.lease.expiresAt) return this.markReconciliationRequired(now);
    if (this.lease.state !== "active") return { ok: true, lease: this.lease, idempotent: true };
    return this.transition(now, "cancellation_requested", false);
  }

  reportTermination(evidence: WorkerTerminationEvidence): LeaseResult {
    if (this.lease.state === "released") return { ok: true, lease: this.lease, idempotent: true };
    if (!this.matchesEvidence(evidence)) return { ok: false, reason: "stale_worker" };
    if (evidence.source !== "trusted_reconciler" || evidence.kind !== "provider_terminated") return { ok: false, reason: "termination_unconfirmed" };
    return this.transition(evidence.observedAt, "cancellation_requested", true);
  }

  renew(workerKeyId: string, generation: number, expiresAt: number, now: number, emergencyStop = false): LeaseResult {
    const access = this.workerAccess(workerKeyId, generation, now, emergencyStop);
    if (!access.ok) return access;
    if (this.lease.state !== "active" || expiresAt <= now || expiresAt <= this.lease.expiresAt) return { ok: false, reason: "reconciliation_required" };
    return this.transition(now, "active", false, undefined, { expiresAt });
  }

  release(workerKeyId: string, generation: number, now: number): LeaseResult {
    if (workerKeyId !== this.lease.workerKeyId || generation !== this.lease.generation) return { ok: false, reason: "stale_worker" };
    if (this.lease.state === "released") return { ok: true, lease: this.lease, idempotent: true };
    const access = this.workerAccess(workerKeyId, generation, now, false);
    if (!access.ok) return access;
    if (!this.lease.terminationConfirmed) return this.markReconciliationRequired(now);
    return this.transition(now, "released", true);
  }

  reconcile(now: number, evidence: WorkerTerminationEvidence): LeaseResult {
    if (this.lease.state === "released") return { ok: true, lease: this.lease, idempotent: true };
    if (!this.matchesEvidence(evidence) || evidence.source !== "trusted_reconciler" || evidence.kind !== "provider_terminated") return this.markReconciliationRequired(now);
    if (now < this.lease.expiresAt && this.lease.state === "active") return { ok: false, reason: "reconciliation_required" };
    return this.transition(now, "released", true);
  }

  private workerAccess(workerKeyId: string, generation: number, now: number, emergencyStop: boolean): LeaseResult {
    if (emergencyStop) return { ok: false, reason: "emergency_stop" };
    if (this.revokedKeys.has(workerKeyId) || this.revokedKeys.has(this.lease.workerKeyId)) return { ok: false, reason: "revoked_key" };
    if (workerKeyId !== this.lease.workerKeyId || generation !== this.lease.generation) return { ok: false, reason: "stale_worker" };
    if (now >= this.lease.expiresAt) return this.markReconciliationRequired(now);
    return { ok: true, lease: this.lease };
  }

  private matchesEvidence(evidence: WorkerTerminationEvidence): boolean {
    return evidence.leaseId === this.lease.leaseId && evidence.generation === this.lease.generation && Number.isFinite(evidence.observedAt) && evidence.observedAt > 0;
  }

  private markReconciliationRequired(now: number): LeaseResult {
    if (this.lease.state === "released") return { ok: true, lease: this.lease, idempotent: true };
    return this.transition(now, "reconciliation_required", false, "reconciliation_required");
  }

  private transition(_now: number, state: WorkerLeaseState, terminationConfirmed: boolean, failure?: LeaseFailureReason, patch: Partial<WorkerLease> = {}): LeaseResult {
    if (!this.auditAvailable) return { ok: false, reason: "audit_unavailable" };
    this.lease = { ...this.lease, ...patch, state, terminationConfirmed: this.lease.terminationConfirmed || terminationConfirmed, version: this.lease.version + 1 };
    return failure ? { ok: false, reason: failure } : { ok: true, lease: this.lease };
  }
}
