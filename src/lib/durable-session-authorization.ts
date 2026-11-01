import { z } from "zod";

export const sessionAuthorizationSchema = z.object({
  authorizationId: z.string().uuid(), organizationId: z.string().uuid(), agentId: z.string().uuid(), actorId: z.string().uuid(),
  sessionId: z.string().uuid(), assertionId: z.string().uuid(), capability: z.literal("voice_sandbox"),
  issuedAt: z.number().int().safe(), expiresAt: z.number().int().safe(), maxDurationSeconds: z.number().int().positive().max(3600),
}).strict().refine((value) => value.expiresAt > value.issuedAt, { message: "authorization expiry must be after issuance" });

export type SessionAuthorization = z.infer<typeof sessionAuthorizationSchema>;
export type SessionContext = Pick<SessionAuthorization, "organizationId" | "agentId" | "actorId" | "sessionId" | "assertionId">;
export type SessionPolicy = { emergencyStop: boolean; concurrencyAvailable: boolean; usageAvailable: boolean };
export type SessionAdmission = { ok: true; authorization: SessionAuthorization; reused: boolean } | { ok: false; error: "invalid" | "expired" | "replayed" | "revoked" | "tenant_mismatch" | "emergency_stop" | "concurrency_unavailable" | "usage_unavailable" };

export interface DurableSessionAuthorizationStore {
  consume(input: unknown, context: SessionContext, policy: SessionPolicy, now: number): Promise<SessionAdmission>;
  revoke(assertionId: string, organizationId: string): Promise<boolean>;
  release(sessionId: string, organizationId: string): Promise<boolean>;
}

const sameContext = (a: SessionAuthorization, b: SessionContext) => a.organizationId === b.organizationId && a.agentId === b.agentId && a.actorId === b.actorId && a.sessionId === b.sessionId && a.assertionId === b.assertionId;

/** Deterministic offline model. Production must replace this with one PostgreSQL transaction. */
export class MemoryDurableSessionAuthorizationStore implements DurableSessionAuthorizationStore {
  private readonly consumed = new Map<string, SessionAuthorization>();
  private readonly revoked = new Set<string>();
  async consume(input: unknown, context: SessionContext, policy: SessionPolicy, now: number): Promise<SessionAdmission> {
    const parsed = sessionAuthorizationSchema.safeParse(input);
    if (!parsed.success || !Number.isSafeInteger(now)) return { ok: false, error: "invalid" };
    const authorization = parsed.data;
    if (!sameContext(authorization, context)) return { ok: false, error: "tenant_mismatch" };
    if (authorization.expiresAt <= now) return { ok: false, error: "expired" };
    if (this.revoked.has(authorization.assertionId)) return { ok: false, error: "revoked" };
    if (policy.emergencyStop) return { ok: false, error: "emergency_stop" };
    if (!policy.concurrencyAvailable) return { ok: false, error: "concurrency_unavailable" };
    if (!policy.usageAvailable) return { ok: false, error: "usage_unavailable" };
    const existing = this.consumed.get(authorization.assertionId);
    if (existing) return sameContext(existing, context) ? { ok: true, authorization: existing, reused: true } : { ok: false, error: "replayed" };
    this.consumed.set(authorization.assertionId, authorization);
    return { ok: true, authorization, reused: false };
  }
  async revoke(assertionId: string, organizationId: string) { const current = this.consumed.get(assertionId); if (!current || current.organizationId !== organizationId) return false; this.revoked.add(assertionId); return true; }
  async release(sessionId: string, organizationId: string) { for (const [assertionId, value] of this.consumed) if (value.sessionId === sessionId && value.organizationId === organizationId) { this.consumed.delete(assertionId); return true; } return false; }
}
