/** Durable-safety contracts. The memory adapter is test-only; production
 * implementations must be transactional, distributed and fail closed. */
export type ReplayClaim = { organizationId: string; provider: string; eventId: string; expiresAt: number };
export type SafetyControl = { organizationId: string; emergencyStop: boolean };
export type GlobalSafetyControl = { emergencyStop: boolean };
export type ReservationRequest = { organizationId: string; provider: string; idempotencyKey: string; maxConcurrent: number; expiresAt: number };
export type ReservationResult = { ok: true; reservationId: string; reused: boolean } | { ok: false; error: "unavailable" | "emergency_stop" | "invalid" | "concurrency_limit" };
export type UsageRequest = { organizationId: string; idempotencyKey: string; amountCents: number; budgetCents: number };
export type UsageResult = { ok: true; recorded: boolean; totalCents: number } | { ok: false; error: "unavailable" | "invalid" | "budget_exceeded" | "emergency_stop" };

export interface DurableSafetyStore {
  claimReplay(claim: ReplayClaim, now: number): Promise<boolean>;
  getControl(organizationId: string): Promise<SafetyControl | undefined>;
  getGlobalControl(): Promise<GlobalSafetyControl | undefined>;
  reserve(request: ReservationRequest, now: number): Promise<ReservationResult>;
  release(organizationId: string, provider: string, reservationId: string): Promise<boolean>;
  recordUsage(request: UsageRequest, now: number): Promise<UsageResult>;
}

const safeNonNegativeInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const requiredText = (value: string) => typeof value === "string" && value.trim().length > 0;
const replayKey = (claim: Pick<ReplayClaim, "organizationId" | "provider" | "eventId">) => JSON.stringify([claim.organizationId, claim.provider, claim.eventId]);
const reservationKey = (request: Pick<ReservationRequest, "organizationId" | "provider" | "idempotencyKey">) => JSON.stringify([request.organizationId, request.provider, request.idempotencyKey]);

/** Deterministic local/test adapter. It is not a distributed production control. */
export class MemoryDurableSafetyStore implements DurableSafetyStore {
  private readonly replay = new Map<string, number>();
  private readonly controls = new Map<string, SafetyControl>();
  private globalControl: GlobalSafetyControl | undefined;
  private readonly reservations = new Map<string, { id: string; organizationId: string; provider: string; expiresAt: number }>();
  private readonly usage = new Map<string, { keys: Map<string, { amountCents: number; budgetCents: number }>; totalCents: number }>();
  setControl(control: SafetyControl) { this.controls.set(control.organizationId, control); }
  setGlobalControl(control: GlobalSafetyControl) { this.globalControl = control; }
  async claimReplay(claim: ReplayClaim, now: number) {
    if (!requiredText(claim.organizationId) || !requiredText(claim.provider) || !requiredText(claim.eventId) || !Number.isSafeInteger(claim.expiresAt) || !Number.isSafeInteger(now) || claim.expiresAt <= now) return false;
    for (const [key, expiry] of this.replay) if (expiry <= now) this.replay.delete(key);
    const key = replayKey(claim); if (this.replay.has(key)) return false; this.replay.set(key, claim.expiresAt); return true;
  }
  async getControl(organizationId: string) { return requiredText(organizationId) ? this.controls.get(organizationId) : undefined; }
  async getGlobalControl() { return this.globalControl; }
  async reserve(request: ReservationRequest, now: number): Promise<ReservationResult> {
    if (!requiredText(request.organizationId) || !requiredText(request.provider) || !requiredText(request.idempotencyKey) || !safeNonNegativeInteger(request.maxConcurrent) || request.maxConcurrent === 0 || !Number.isSafeInteger(request.expiresAt) || !Number.isSafeInteger(now) || request.expiresAt <= now) return { ok: false, error: "invalid" };
    const control = await this.getControl(request.organizationId); const global = await this.getGlobalControl(); if (!control || !global || typeof control.emergencyStop !== "boolean" || typeof global.emergencyStop !== "boolean") return { ok: false, error: "unavailable" }; if (control.emergencyStop || global.emergencyStop) return { ok: false, error: "emergency_stop" };
    for (const [key, reservation] of this.reservations) if (reservation.expiresAt <= now) this.reservations.delete(key);
    const key = reservationKey(request); const existing = this.reservations.get(key); if (existing) return { ok: true, reservationId: existing.id, reused: true };
    const active = [...this.reservations.values()].filter((item) => item.organizationId === request.organizationId && item.provider === request.provider).length; if (active >= request.maxConcurrent) return { ok: false, error: "concurrency_limit" };
    const reservationId = `${request.organizationId}:${request.provider}:${request.idempotencyKey}`; this.reservations.set(key, { id: reservationId, organizationId: request.organizationId, provider: request.provider, expiresAt: request.expiresAt }); return { ok: true, reservationId, reused: false };
  }
  async release(organizationId: string, provider: string, reservationId: string) { for (const [key, reservation] of this.reservations) if (reservation.organizationId === organizationId && reservation.provider === provider && reservation.id === reservationId) { this.reservations.delete(key); return true; } return false; }
  async recordUsage(request: UsageRequest, _now: number): Promise<UsageResult> {
    if (!requiredText(request.organizationId) || !requiredText(request.idempotencyKey) || !safeNonNegativeInteger(request.amountCents) || !safeNonNegativeInteger(request.budgetCents)) return { ok: false, error: "invalid" };
    const control = await this.getControl(request.organizationId); const global = await this.getGlobalControl(); if (!control || !global || typeof control.emergencyStop !== "boolean" || typeof global.emergencyStop !== "boolean") return { ok: false, error: "unavailable" }; if (control.emergencyStop || global.emergencyStop) return { ok: false, error: "emergency_stop" };
    const current = this.usage.get(request.organizationId) ?? { keys: new Map<string, { amountCents: number; budgetCents: number }>(), totalCents: 0 };
    const previous = current.keys.get(request.idempotencyKey);
    if (previous) return previous.amountCents === request.amountCents && previous.budgetCents === request.budgetCents
      ? { ok: true, recorded: false, totalCents: current.totalCents }
      : { ok: false, error: "invalid" };
    if (request.amountCents > Number.MAX_SAFE_INTEGER - current.totalCents) return { ok: false, error: "invalid" };
    if (current.totalCents + request.amountCents > request.budgetCents) return { ok: false, error: "budget_exceeded" };
    current.keys.set(request.idempotencyKey, { amountCents: request.amountCents, budgetCents: request.budgetCents }); current.totalCents += request.amountCents; this.usage.set(request.organizationId, current); return { ok: true, recorded: true, totalCents: current.totalCents };
  }
}
