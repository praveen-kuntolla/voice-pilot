import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const signedAdmissionClaimsSchema = z.object({
  version: z.literal(1), keyId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), assertionId: z.string().uuid(), organizationId: z.string().trim().min(1).max(160), agentId: z.string().trim().min(1).max(160), actorId: z.string().trim().min(1).max(160), sessionId: z.string().uuid(), issuedAt: z.number().int().nonnegative().safe(), expiresAt: z.number().int().nonnegative().safe(), capability: z.literal("voice_sandbox"), maxDurationSeconds: z.number().int().min(1).max(300), usageLimit: z.object({ inputCharacters: z.number().int().nonnegative().max(100000), outputCharacters: z.number().int().nonnegative().max(100000) }).strict(), providerActivationEnabled: z.literal(false),
}).strict().superRefine((value, ctx) => { if (value.expiresAt <= value.issuedAt) ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "expiry must follow issuance" }); });
export type SignedAdmissionClaims = z.infer<typeof signedAdmissionClaimsSchema>;
export type SignedAdmission = { claims: SignedAdmissionClaims; signature: string };
export type AdmissionKeyResolver = (keyId: string) => string | undefined;

function lengthPrefix(value: string) { return `${value.length}:${value}`; }
export function canonicalAdmission(claims: SignedAdmissionClaims): string { return ["voicepilot-admission", String(claims.version), lengthPrefix(claims.keyId), lengthPrefix(claims.assertionId), lengthPrefix(claims.organizationId), lengthPrefix(claims.agentId), lengthPrefix(claims.actorId), lengthPrefix(claims.sessionId), String(claims.issuedAt), String(claims.expiresAt), lengthPrefix(claims.capability), String(claims.maxDurationSeconds), String(claims.usageLimit.inputCharacters), String(claims.usageLimit.outputCharacters), "providerActivationEnabled=false"].join("|"); }
export function signAdmission(claims: SignedAdmissionClaims, secret: string): string { return createHmac("sha256", secret).update(canonicalAdmission(claims), "utf8").digest("hex"); }
export function verifySignedAdmission(input: unknown, resolveKey: AdmissionKeyResolver, now: number, context: { organizationId: string; agentId: string; actorId: string }, state: { replayed?: boolean; revoked?: boolean; emergencyStop?: boolean; concurrencyAvailable?: boolean } = {}): boolean {
  const parsed = z.object({ claims: signedAdmissionClaimsSchema, signature: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(input); if (!parsed.success || !Number.isSafeInteger(now)) return false;
  const { claims, signature } = parsed.data; const secret = resolveKey(claims.keyId); if (!secret || claims.expiresAt <= now || claims.organizationId !== context.organizationId || claims.agentId !== context.agentId || claims.actorId !== context.actorId || state.replayed || state.revoked || state.emergencyStop || state.concurrencyAvailable === false) return false;
  const expected = Buffer.from(signAdmission(claims, secret), "hex"); const supplied = Buffer.from(signature, "hex"); return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export class MemoryAdmissionState {
  private readonly consumed = new Set<string>(); private readonly revoked = new Set<string>();
  consume(assertionId: string) { if (this.consumed.has(assertionId)) return false; this.consumed.add(assertionId); return true; }
  revoke(assertionId: string) { this.revoked.add(assertionId); }
  isRevoked(assertionId: string) { return this.revoked.has(assertionId); }
  clear(assertionId: string) { this.consumed.delete(assertionId); this.revoked.delete(assertionId); }
}
