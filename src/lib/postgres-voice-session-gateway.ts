import { randomUUID } from "node:crypto";
import type { SafetyQuery } from "@/lib/postgres-durable-safety";
import type { SafetyTransactionExecutor } from "@/lib/privileged-safety-gateway";
import { validateOfflineVoiceSessionRequest, type VoiceSessionRequest } from "@/lib/provider-contracts";
import { sessionAuthorizationSchema, type SessionContext, type SessionPolicy } from "@/lib/durable-session-authorization";
import { type SignedAdmission, verifySignedAdmission, type AdmissionKeyResolver } from "@/lib/signed-admission";

if (typeof window !== "undefined") throw new Error("PostgreSQL voice session gateway is server-only");

type GatewayRow = Record<string, unknown>;
type GatewayError = "invalid" | "unauthorized" | "expired" | "replayed" | "revoked" | "tenant_mismatch" | "emergency_stop" | "concurrency_unavailable" | "usage_unavailable" | "unavailable";
type GatewayDeps = { executor: SafetyTransactionExecutor; resolveKey: AdmissionKeyResolver; now: () => number; policy: (context: SessionContext) => Promise<SessionPolicy> | SessionPolicy; disposableEnvironment: boolean; providerActivationEnabled?: boolean };

export type PostgresVoiceSessionInput = { request: unknown; admission: unknown; authorization: unknown; context: SessionContext };
export type PostgresVoiceSessionResult = { ok: true; session: { sessionId: string; assertionId: string; organizationId: string; agentId: string; actorId: string; simulationOnly: true; providerActivationEnabled: false; noRecording: true; reused: boolean } } | { ok: false; error: GatewayError };

const one = async <T extends GatewayRow>(query: SafetyQuery, sql: string, values: readonly unknown[]) => (await query<T>(sql, values)).rows[0];

function resultError(value: unknown): GatewayError {
  const error = typeof value === "object" && value !== null && "error" in value ? (value as { error?: unknown }).error : undefined;
  return error === "expired" || error === "replayed" || error === "revoked" || error === "tenant_mismatch" || error === "emergency_stop" || error === "concurrency_unavailable" || error === "usage_unavailable" ? error : "unavailable";
}

/** Uses only the reviewed 017–019 SQL routines. No fallback store is permitted. */
export async function startPostgresVoiceSession(input: PostgresVoiceSessionInput, deps: GatewayDeps): Promise<PostgresVoiceSessionResult> {
  const request = validateOfflineVoiceSessionRequest(input.request);
  const authorization = sessionAuthorizationSchema.safeParse(input.authorization);
  const admission = input.admission as SignedAdmission;
  if (!deps.disposableEnvironment || deps.providerActivationEnabled === true || !request || !authorization.success || !Number.isSafeInteger(deps.now())) return { ok: false, error: "invalid" };
  const a = authorization.data;
  if (a.organizationId !== request.organizationId || a.agentId !== request.agentId || a.actorId !== request.actorId || a.sessionId !== request.sessionId || a.assertionId !== admission?.claims?.assertionId || a.maxDurationSeconds !== admission?.claims?.maxDurationSeconds) return { ok: false, error: "tenant_mismatch" };
  if (!verifySignedAdmission(admission, deps.resolveKey, deps.now(), input.context)) return { ok: false, error: "unauthorized" };
  const policy = await deps.policy(input.context);
  if (policy.emergencyStop) return { ok: false, error: "emergency_stop" };
  if (!policy.concurrencyAvailable) return { ok: false, error: "concurrency_unavailable" };
  if (!policy.usageAvailable) return { ok: false, error: "usage_unavailable" };
  try {
    return await deps.executor.transaction(async (query) => {
      await query("select set_config('request.jwt.claim.sub',$1::text,true), set_config('voicepilot.organization_id',$2::text,true)", [a.actorId, a.organizationId]);
      const row = await one<{ result: unknown }>(query, "select public.consume_voice_session_authorization($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,$5::integer,$6::integer) as result", [a.assertionId, a.organizationId, a.actorId, new Date(deps.now()).toISOString(), 1, a.maxDurationSeconds]);
      const result = row?.result;
      if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) return { ok: false, error: resultError(result) };
      return { ok: true, session: { sessionId: a.sessionId, assertionId: a.assertionId, organizationId: a.organizationId, agentId: a.agentId, actorId: a.actorId, simulationOnly: true, providerActivationEnabled: false, noRecording: true, reused: (result as { reused?: boolean }).reused === true } };
    });
  } catch { return { ok: false, error: "unavailable" }; }
}

export async function releasePostgresVoiceSession(context: SessionContext, deps: Pick<GatewayDeps, "executor" | "disposableEnvironment">) {
  if (!deps.disposableEnvironment) return { ok: false as const, released: false as const, error: "unavailable" as const };
  try {
    return await deps.executor.transaction(async (query) => {
      await query("select set_config('request.jwt.claim.sub',$1::text,true), set_config('voicepilot.organization_id',$2::text,true)", [context.actorId, context.organizationId]);
      const row = await one<{ result: boolean }>(query, "select public.release_voice_session_authorization($1::uuid,$2::uuid,$3::uuid) as result", [context.sessionId, context.organizationId, context.actorId]);
      return { ok: true as const, released: row?.result === true };
    });
  } catch { return { ok: false as const, released: false as const, error: "unavailable" as const }; }
}

export async function createPostgresVoiceAuthorization(input: { organizationId: string; agentId: string; actorId: string; sessionId: string; assertionId: string; issuedAt: number; expiresAt: number }, deps: Pick<GatewayDeps, "executor" | "disposableEnvironment">) {
  if (!deps.disposableEnvironment) return { ok: false as const, error: "unavailable" as const };
  const authorizationId = randomUUID();
  try {
    return await deps.executor.transaction(async (query) => {
      await query("select set_config('request.jwt.claim.sub',$1::text,true), set_config('voicepilot.organization_id',$2::text,true)", [input.actorId, input.organizationId]);
      await query("select public.create_voice_session_authorization($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::timestamptz,$8::timestamptz)", [authorizationId, input.organizationId, input.agentId, input.actorId, input.sessionId, input.assertionId, new Date(input.issuedAt).toISOString(), new Date(input.expiresAt).toISOString()]);
      return { ok: true as const, authorization: { authorizationId, ...input, capability: "voice_sandbox" as const, maxDurationSeconds: 60 } };
    });
  } catch { return { ok: false as const, error: "unavailable" as const }; }
}
