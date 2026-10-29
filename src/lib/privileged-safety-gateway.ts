import { PostgresDurableSafetyStore, type SafetyQuery } from "@/lib/postgres-durable-safety";
import { authorizeTrustedActor, type TrustedIdentitySource } from "@/lib/trusted-authorization";
import type { ReservationRequest, UsageRequest } from "@/lib/durable-safety";
import { authorizeProviderAction, type PolicyContextRepository } from "@/lib/policy-enforcement-gateway";
import { GatewayTransactionAbort } from "@/lib/gateway-transaction-abort";
import { createGatewayEvent, type GatewayEventSink, type GatewayEventType } from "@/lib/gateway-observability";
import { PostgresGatewayEventSink } from "@/lib/gateway-audit";

if (typeof window !== "undefined") throw new Error("Privileged safety execution is server-only");

export interface SafetyTransactionExecutor {
  transaction<T>(work: (query: SafetyQuery) => Promise<T>): Promise<T>;
}
export type PrivilegedSafetyOperation =
  | { kind: "read_controls"; organizationId: string }
  | { kind: "reserve"; organizationId: string; request: ReservationRequest; now: number }
  | { kind: "release"; organizationId: string; provider: string; reservationId: string }
  | { kind: "record_usage"; organizationId: string; request: UsageRequest; now: number };

export type PrivilegedSafetyResult =
  | { status: "success"; value: unknown }
  | { status: "denied"; reason: string }
  | { status: "safety_blocked"; reason: string }
  | { status: "unavailable"; reason: string };
type PrivilegedSafetyFailure = Exclude<PrivilegedSafetyResult, { status: "success" }>;

export type ProviderActionPreparation = {
  kind: "reserve" | "record_usage";
  organizationId: string;
  campaignId: string;
  agentId: string;
  contactId: string;
  idempotencyKey: string;
  attemptKind?: "original" | "retry";
  claimedActorId?: string;
};

export async function executePrivilegedSafetyOperation(deps: {
  identity: TrustedIdentitySource;
  executor: SafetyTransactionExecutor;
  now: () => number;
}, operation: PrivilegedSafetyOperation, claimedActorId?: string): Promise<PrivilegedSafetyResult> {
  if (operation.kind === "reserve" || operation.kind === "record_usage") return { status: "denied", reason: "composed_policy_gateway_required" };
  const evaluationTime = deps.now();
  const auth = await authorizeTrustedActor(deps.identity, {
    organizationId: operation.organizationId,
    operation: "execute_privileged",
    claimedActorId,
  }, evaluationTime);
  if (!auth.ok) return { status: "denied", reason: auth.reason };
  try {
    return await deps.executor.transaction(async (query) => {
      await query("select set_config('request.jwt.claim.sub',$1::text,true), set_config('voicepilot.organization_id',$2::text,true)", [auth.actorId, auth.organizationId]);
      const store = new PostgresDurableSafetyStore(query);
      if (operation.kind === "read_controls") {
        const [global, organization] = await Promise.all([store.getGlobalControl(), store.getControl(auth.organizationId)]);
        if (!global || !organization) return { status: "unavailable", reason: "required_control_missing" } as const;
        if (global.emergencyStop || organization.emergencyStop) return { status: "safety_blocked", reason: "emergency_stop" } as const;
        return { status: "success", value: { global, organization } } as const;
      }
      if (operation.kind === "release") return (await store.release(auth.organizationId, operation.provider, operation.reservationId))
        ? { status: "success", value: true } as const : { status: "unavailable", reason: "release_failed" } as const;
      return { status: "denied", reason: "unsupported_operation" } as const;
    });
  } catch {
    return { status: "unavailable", reason: "transaction_failed" };
  }
}

/** Offline-only composed preparation. The repository must use the supplied
 * transaction query for rate/policy state so a failed preparation rolls back
 * its claims. This function never dispatches a call, message, or provider job. */
export async function prepareOfflineProviderAction(deps: {
  identity: TrustedIdentitySource;
  executor: SafetyTransactionExecutor;
  createPolicyRepository(query: SafetyQuery): PolicyContextRepository;
  now: () => number;
  reservationTtlMs: number;
  observer?: GatewayEventSink;
  correlationId?: string;
}, input: ProviderActionPreparation): Promise<PrivilegedSafetyResult> {
  const evaluationTime = deps.now();
  if (!Number.isSafeInteger(evaluationTime) || evaluationTime < 0 || !Number.isSafeInteger(deps.reservationTtlMs) || deps.reservationTtlMs < 1 || !Number.isSafeInteger(evaluationTime + deps.reservationTtlMs)) return { status: "denied", reason: "invalid_server_configuration" };
  try {
    return await deps.executor.transaction(async (query) => {
      const store = new PostgresDurableSafetyStore(query);
      const decision = await authorizeProviderAction({ identity: deps.identity, repository: deps.createPolicyRepository(query), safety: store, now: () => evaluationTime,
        bindVerifiedContext: async (verified) => { await query("select set_config('request.jwt.claim.sub',$1::text,true), set_config('voicepilot.organization_id',$2::text,true)", [verified.actorId, verified.organizationId]); } }, input);
      if (!decision.ok) throw new GatewayTransactionAbort<PrivilegedSafetyFailure>({ status: decision.category, reason: decision.reason });
      if (input.kind === "reserve") {
        const expiresAt = evaluationTime + deps.reservationTtlMs;
        const attempt = await store.reserveRetryAttempt({ organizationId: decision.organizationId, campaignId: input.campaignId, contactId: input.contactId, agentId: input.agentId, provider: decision.execution.provider, idempotencyKey: decision.idempotencyKey, attemptKind: input.attemptKind ?? "original", maxAttempts: decision.execution.maxAttempts, expiresAt }, evaluationTime);
        if (!attempt.ok) throw new GatewayTransactionAbort<PrivilegedSafetyFailure>({ status: attempt.error === "retry_limit" || attempt.error === "policy_changed" || attempt.error === "conflict" ? "safety_blocked" : "unavailable", reason: attempt.error });
        const result = await store.reserve({ organizationId: decision.organizationId, provider: decision.execution.provider, idempotencyKey: decision.idempotencyKey, maxConcurrent: decision.execution.maxConcurrent, expiresAt }, evaluationTime);
        if (!result.ok) throw new GatewayTransactionAbort<PrivilegedSafetyFailure>({ status: result.error === "concurrency_limit" || result.error === "emergency_stop" ? "safety_blocked" : "unavailable", reason: result.error });
        const usage = await store.reserveUsage({ organizationId: decision.organizationId, idempotencyKey: decision.idempotencyKey, amountCents: decision.execution.amountCents, budgetCents: decision.execution.budgetCents, expiresAt }, evaluationTime);
        if (!usage.ok) throw new GatewayTransactionAbort<PrivilegedSafetyFailure>({ status: usage.error === "budget_exceeded" ? "safety_blocked" : "unavailable", reason: usage.error });
        await new PostgresGatewayEventSink(query).emit({ type: "preparation_committed", correlationId: deps.correlationId ?? decision.idempotencyKey, organizationId: decision.organizationId, reason: "offline_reservation_prepared", occurredAt: evaluationTime });
        return { status: "success", value: { prepared: true, simulationOnly: true, attempt, reservation: result, usage } };
      }
      const result = await store.recordUsage({ organizationId: decision.organizationId, idempotencyKey: decision.idempotencyKey, amountCents: decision.execution.amountCents, budgetCents: decision.execution.budgetCents }, evaluationTime);
      if (!result.ok) throw new GatewayTransactionAbort<PrivilegedSafetyFailure>({ status: result.error === "budget_exceeded" || result.error === "emergency_stop" ? "safety_blocked" : "unavailable", reason: result.error });
      await new PostgresGatewayEventSink(query).emit({ type: "preparation_committed", correlationId: deps.correlationId ?? decision.idempotencyKey, organizationId: decision.organizationId, reason: "offline_usage_recorded", occurredAt: evaluationTime });
      return { status: "success", value: { prepared: true, simulationOnly: true, usage: result } };
    });
  } catch (error) {
    const result = error instanceof GatewayTransactionAbort ? error.result : { status: "unavailable" as const, reason: "transaction_failed" };
    const eventTypes: Record<string, GatewayEventType> = { emergency_stop: "emergency_stop_rejected", rate_limit_reached: "rate_exhausted", concurrency_limit: "concurrency_exhausted", duplicate_idempotency_key: "duplicate_idempotency", conflict:"idempotency_conflict", budget_exceeded: "budget_rejected", retry_limit: "retry_limit_exhausted", consent_required: "consent_rejected", consent_revoked: "consent_rejected", opted_out: "consent_rejected" };
    const event = createGatewayEvent({ type: eventTypes[result.reason] ?? "authorization_denied", correlationId: deps.correlationId ?? "offline-gateway", organizationId: input.organizationId, reason: result.reason, occurredAt: evaluationTime });
    if (event) await deps.observer?.emit(event);
    return result;
  }
}
