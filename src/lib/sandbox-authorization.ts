import { z } from "zod";

const boundedId = z.string().trim().min(1).max(160);
const safeInteger = z.number().int().nonnegative().safe();

export const sandboxCapabilitySchema = z.literal("voice_sandbox");
export const sandboxAuthorizationClaimsSchema = z.object({
  organizationId: boundedId,
  agentId: boundedId,
  actorId: boundedId,
  sessionId: z.string().uuid(),
  issuedAt: safeInteger,
  expiresAt: safeInteger,
  capability: sandboxCapabilitySchema,
  maxDurationSeconds: z.number().int().min(1).max(300),
  maxConcurrentSessions: z.literal(1),
  usageLimit: z.object({
    inputCharacters: z.number().int().min(0).max(100_000),
    outputCharacters: z.number().int().min(0).max(100_000),
  }).strict(),
  providerActivationEnabled: z.literal(false),
  emergencyStop: z.literal(false),
}).strict().superRefine((claims, ctx) => {
  if (claims.expiresAt <= claims.issuedAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Session expiry must follow issuance." });
});
export type SandboxAuthorizationClaims = z.infer<typeof sandboxAuthorizationClaimsSchema>;

export type SandboxAuthorizationContext = Pick<SandboxAuthorizationClaims, "organizationId" | "agentId" | "actorId">;
export type SandboxAuthorizationFailure = "invalid_claims" | "expired" | "replayed" | "revoked" | "tenant_mismatch" | "emergency_stop" | "usage_exceeded" | "concurrency_exceeded" | "unavailable";
export type SandboxAuthorizationResult = { ok: true; claims: SandboxAuthorizationClaims } | { ok: false; error: SandboxAuthorizationFailure };

type SessionState = { claims: SandboxAuthorizationClaims; fingerprint: string; revoked: boolean; usage: { inputCharacters: number; outputCharacters: number } };

/** Development-only, process-local authorization state. It is not global revocation. */
export class MemorySandboxAuthorizationStore {
  private readonly sessions = new Map<string, SessionState>();
  constructor(private readonly now: () => number = () => Date.now(), private readonly emergencyStop: () => boolean = () => false) {}

  claim(input: unknown): SandboxAuthorizationResult {
    const parsed = sandboxAuthorizationClaimsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid_claims" };
    const claims = parsed.data;
    const now = this.now();
    if (!Number.isSafeInteger(now) || claims.expiresAt <= now) return { ok: false, error: "expired" };
    if (this.emergencyStop() || claims.emergencyStop) return { ok: false, error: "emergency_stop" };
    if (this.sessions.has(claims.sessionId)) return { ok: false, error: "replayed" };
    this.sessions.set(claims.sessionId, { claims, fingerprint: JSON.stringify(claims), revoked: false, usage: { inputCharacters: 0, outputCharacters: 0 } });
    return { ok: true, claims };
  }

  authorize(sessionId: string, context: SandboxAuthorizationContext): SandboxAuthorizationResult {
    const state = this.sessions.get(sessionId);
    if (!state) return { ok: false, error: "unavailable" };
    const now = this.now();
    if (!Number.isSafeInteger(now) || state.claims.expiresAt <= now) return { ok: false, error: "expired" };
    if (state.revoked) return { ok: false, error: "revoked" };
    if (this.emergencyStop() || state.claims.emergencyStop) return { ok: false, error: "emergency_stop" };
    if (state.claims.organizationId !== context.organizationId || state.claims.agentId !== context.agentId || state.claims.actorId !== context.actorId) return { ok: false, error: "tenant_mismatch" };
    return { ok: true, claims: state.claims };
  }

  consumeUsage(sessionId: string, context: SandboxAuthorizationContext, usage: { inputCharacters: number; outputCharacters: number }): SandboxAuthorizationResult {
    const authorized = this.authorize(sessionId, context);
    if (!authorized.ok) return authorized;
    if (!Number.isSafeInteger(usage.inputCharacters) || usage.inputCharacters < 0 || !Number.isSafeInteger(usage.outputCharacters) || usage.outputCharacters < 0) return { ok: false, error: "usage_exceeded" };
    const state = this.sessions.get(sessionId)!;
    const nextInput = state.usage.inputCharacters + usage.inputCharacters;
    const nextOutput = state.usage.outputCharacters + usage.outputCharacters;
    if (!Number.isSafeInteger(nextInput) || !Number.isSafeInteger(nextOutput) || nextInput > authorized.claims.usageLimit.inputCharacters || nextOutput > authorized.claims.usageLimit.outputCharacters) return { ok: false, error: "usage_exceeded" };
    state.usage = { inputCharacters: nextInput, outputCharacters: nextOutput };
    return authorized;
  }

  revoke(sessionId: string, context: SandboxAuthorizationContext): boolean {
    const state = this.sessions.get(sessionId);
    if (!state || state.claims.organizationId !== context.organizationId || state.claims.agentId !== context.agentId || state.claims.actorId !== context.actorId) return false;
    state.revoked = true;
    return true;
  }

  cleanup(sessionId: string) { this.sessions.delete(sessionId); }
  has(sessionId: string) { return this.sessions.has(sessionId); }
}
