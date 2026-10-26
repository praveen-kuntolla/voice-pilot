/** Server-side PostgreSQL adapter for review-only safety RPCs. No connection is
 * constructed here: a separately authorized server component must inject a
 * privileged, parameter-binding PostgreSQL executor. Never import in a client. */
import type { DurableSafetyStore, GlobalSafetyControl, ReplayClaim, ReservationRequest, ReservationResult, SafetyControl, UsageRequest, UsageResult } from "./durable-safety";

if (typeof window !== "undefined") throw new Error("PostgreSQL safety controls are server-only");

export type SafetyQuery = <T extends Record<string, unknown>>(sql: string, values: readonly unknown[]) => Promise<{ rows: T[] }>;
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const text = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 256;
const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
const instant = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 8_640_000_000_000_000;

export class PostgresDurableSafetyStore implements DurableSafetyStore {
  constructor(private readonly query: SafetyQuery) {}

  private async one<T extends Record<string, unknown>>(sql: string, values: readonly unknown[]): Promise<T | undefined> {
    return (await this.query<T>(sql, values)).rows[0];
  }

  async claimReplay(claim: ReplayClaim, now: number): Promise<boolean> {
    if (!uuid(claim.organizationId) || !text(claim.provider) || !text(claim.eventId) || !instant(now) || !instant(claim.expiresAt) || claim.expiresAt <= now) return false;
    try {
      return (await this.one<{ result: boolean }>("select voicepilot_safety.claim_replay($1::uuid,$2::text,$3::text,$4::timestamptz) as result", [claim.organizationId, claim.provider, claim.eventId, new Date(claim.expiresAt).toISOString()]))?.result === true;
    } catch { return false; }
  }

  async getControl(organizationId: string): Promise<SafetyControl | undefined> {
    if (!uuid(organizationId)) return undefined;
    try {
      const row = await this.one<{ emergency_stop: boolean }>("select emergency_stop from public.provider_safety_controls where organization_id=$1::uuid", [organizationId]);
      return typeof row?.emergency_stop === "boolean" ? { organizationId, emergencyStop: row.emergency_stop } : undefined;
    } catch { return undefined; }
  }

  async getGlobalControl(): Promise<GlobalSafetyControl | undefined> {
    try {
      const row = await this.one<{ emergency_stop: boolean }>("select emergency_stop from voicepilot_safety.provider_global_stop where singleton=true", []);
      return typeof row?.emergency_stop === "boolean" ? { emergencyStop: row.emergency_stop } : undefined;
    } catch { return undefined; }
  }

  async reserve(request: ReservationRequest, now: number): Promise<ReservationResult> {
    if (!uuid(request.organizationId) || !text(request.provider) || !text(request.idempotencyKey) || !Number.isSafeInteger(request.maxConcurrent) || request.maxConcurrent < 1 || request.maxConcurrent > 100_000 || !instant(now) || !instant(request.expiresAt) || request.expiresAt <= now) return { ok: false, error: "invalid" };
    try {
      const row = await this.one<{ result: ReservationResult }>("select voicepilot_safety.reserve_action($1::uuid,$2::text,$3::text,$4::integer,$5::timestamptz) as result", [request.organizationId, request.provider, request.idempotencyKey, request.maxConcurrent, new Date(request.expiresAt).toISOString()]);
      const result = row?.result;
      return result?.ok === true && typeof result.reservationId === "string" ? result : { ok: false, error: result?.ok === false && result.error === "concurrency_limit" ? "concurrency_limit" : "unavailable" };
    } catch { return { ok: false, error: "unavailable" }; }
  }

  async release(organizationId: string, provider: string, reservationId: string): Promise<boolean> {
    if (!uuid(organizationId) || !text(provider) || !uuid(reservationId)) return false;
    try { return (await this.one<{ result: boolean }>("select voicepilot_safety.release_action($1::uuid,$2::text,$3::uuid) as result", [organizationId, provider, reservationId]))?.result === true; }
    catch { return false; }
  }

  async recordUsage(request: UsageRequest, now: number): Promise<UsageResult> {
    if (!uuid(request.organizationId) || !text(request.idempotencyKey) || !cents(request.amountCents) || !cents(request.budgetCents) || !instant(now)) return { ok: false, error: "invalid" };
    try {
      const row = await this.one<{ result: UsageResult }>("select voicepilot_safety.record_usage($1::uuid,$2::text,$3::bigint,$4::bigint) as result", [request.organizationId, request.idempotencyKey, request.amountCents, request.budgetCents]);
      const result = row?.result;
      return result?.ok === true && cents(result.totalCents) ? result : { ok: false, error: result?.ok === false && result.error === "budget_exceeded" ? "budget_exceeded" : "unavailable" };
    } catch { return { ok: false, error: "unavailable" }; }
  }
}
