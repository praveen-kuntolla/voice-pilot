import { validateOfflineVoiceSessionRequest, type VoiceSessionRequest } from "@/lib/provider-contracts";
import { type SignedAdmission, verifySignedAdmission, type AdmissionKeyResolver } from "@/lib/signed-admission";
import { sessionAuthorizationSchema, type DurableSessionAuthorizationStore, type SessionAuthorization, type SessionContext, type SessionPolicy } from "@/lib/durable-session-authorization";

if (typeof window !== "undefined") throw new Error("Offline voice session gateway is server-only");

export type OfflineVoiceSessionGatewayInput = {
  request: unknown;
  admission: unknown;
  authorization: unknown;
  context: SessionContext;
};

export type OfflineVoiceSession = {
  sessionId: string;
  organizationId: string;
  agentId: string;
  actorId: string;
  status: "active";
  simulationOnly: true;
  providerActivationEnabled: false;
  noRecording: true;
  maxDurationSeconds: number;
  reused: boolean;
};

export type OfflineVoiceSessionGatewayResult =
  | { ok: true; session: OfflineVoiceSession }
  | { ok: false; error: "invalid" | "unauthorized" | "expired" | "replayed" | "revoked" | "tenant_mismatch" | "emergency_stop" | "concurrency_unavailable" | "usage_unavailable" };

export type OfflineVoiceSessionGatewayDeps = {
  now: () => number;
  resolveKey: AdmissionKeyResolver;
  store: DurableSessionAuthorizationStore;
  policy: (context: SessionContext) => Promise<SessionPolicy> | SessionPolicy;
};

const authorizationMatchesRequest = (authorization: SessionAuthorization, request: VoiceSessionRequest) =>
  authorization.organizationId === request.organizationId && authorization.agentId === request.agentId && authorization.actorId === request.actorId && authorization.sessionId === request.sessionId;

/**
 * Server-only offline admission boundary. It intentionally never creates a room,
 * invokes a provider, captures audio, or persists a simulated conversation.
 * Replace the injected store with the reviewed PostgreSQL transaction before any
 * separately approved provider connectivity work.
 */
export async function startOfflineVoiceSession(input: OfflineVoiceSessionGatewayInput, deps: OfflineVoiceSessionGatewayDeps): Promise<OfflineVoiceSessionGatewayResult> {
  const request = validateOfflineVoiceSessionRequest(input.request);
  const authorization = sessionAuthorizationSchema.safeParse(input.authorization);
  const admission = input.admission as SignedAdmission;
  if (!request || !authorization.success || !Number.isSafeInteger(deps.now())) return { ok: false, error: "invalid" };
  if (!authorizationMatchesRequest(authorization.data, request) || authorization.data.assertionId !== admission?.claims?.assertionId || authorization.data.capability !== admission?.claims?.capability || authorization.data.maxDurationSeconds !== admission?.claims?.maxDurationSeconds) return { ok: false, error: "unauthorized" };
  if (!verifySignedAdmission(admission, deps.resolveKey, deps.now(), input.context)) return { ok: false, error: "unauthorized" };
  const policy = await deps.policy(input.context);
  const result = await deps.store.consume(authorization.data, input.context, policy, deps.now());
  if (!result.ok) return result;
  return { ok: true, session: { sessionId: request.sessionId, organizationId: request.organizationId, agentId: request.agentId, actorId: request.actorId, status: "active", simulationOnly: true, providerActivationEnabled: false, noRecording: true, maxDurationSeconds: request.maxDurationSeconds, reused: result.reused } };
}

export async function cancelOfflineVoiceSession(input: Pick<SessionContext, "sessionId" | "organizationId">, store: DurableSessionAuthorizationStore) {
  const released = await store.release(input.sessionId, input.organizationId);
  return { ok: true as const, status: "cancelled" as const, simulationOnly: true as const, released };
}
