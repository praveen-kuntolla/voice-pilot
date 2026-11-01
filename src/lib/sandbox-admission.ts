import { z } from "zod";
import { sandboxAuthorizationClaimsSchema, type SandboxAuthorizationClaims } from "./sandbox-authorization";

export const sandboxAdmissionRequestSchema = z.object({
  claims: sandboxAuthorizationClaimsSchema,
  organizationId: z.string().trim().min(1).max(160),
  agentId: z.string().trim().min(1).max(160),
  actorId: z.string().trim().min(1).max(160),
}).strict();

export type SandboxAdmissionFailure = "invalid_claims" | "expired" | "tenant_mismatch" | "emergency_stop" | "provider_disabled" | "concurrency_exceeded" | "revoked" | "replayed";
export type SandboxAdmissionResult = { ok: true; claims: SandboxAuthorizationClaims } | { ok: false; error: SandboxAdmissionFailure };

export type SandboxAdmissionDependencies = {
  now: number;
  emergencyStop: boolean;
  providerActivationEnabled: boolean;
  revoked?: boolean;
  replayed?: boolean;
  concurrencyAvailable?: boolean;
};

/** Pure server/worker boundary. It issues no token and performs no network operation. */
export function evaluateSandboxAdmission(input: unknown, dependencies: SandboxAdmissionDependencies): SandboxAdmissionResult {
  const parsed = sandboxAdmissionRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_claims" };
  const { claims, organizationId, agentId, actorId } = parsed.data;
  if (!Number.isSafeInteger(dependencies.now) || claims.expiresAt <= dependencies.now) return { ok: false, error: "expired" };
  if (claims.organizationId !== organizationId || claims.agentId !== agentId || claims.actorId !== actorId) return { ok: false, error: "tenant_mismatch" };
  if (dependencies.emergencyStop || claims.emergencyStop) return { ok: false, error: "emergency_stop" };
  if (dependencies.providerActivationEnabled || claims.providerActivationEnabled) return { ok: false, error: "provider_disabled" };
  if (dependencies.replayed) return { ok: false, error: "replayed" };
  if (dependencies.revoked) return { ok: false, error: "revoked" };
  if (dependencies.concurrencyAvailable === false) return { ok: false, error: "concurrency_exceeded" };
  return { ok: true, claims };
}
