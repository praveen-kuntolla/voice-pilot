import { PostgresDurableSafetyStore, type SafetyQuery } from "@/lib/postgres-durable-safety";
import { authorizeTrustedActor, type TrustedIdentitySource } from "@/lib/trusted-authorization";
import type { ReservationRequest, UsageRequest } from "@/lib/durable-safety";

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

export async function executePrivilegedSafetyOperation(deps: {
  identity: TrustedIdentitySource;
  executor: SafetyTransactionExecutor;
  now: () => number;
}, operation: PrivilegedSafetyOperation, claimedActorId?: string): Promise<PrivilegedSafetyResult> {
  const auth = await authorizeTrustedActor(deps.identity, {
    organizationId: operation.organizationId,
    operation: "execute_privileged",
    claimedActorId,
  }, deps.now());
  if (!auth.ok) return { status: "denied", reason: auth.reason };
  if ((operation.kind === "reserve" || operation.kind === "record_usage") && operation.request.organizationId !== auth.organizationId) return { status: "denied", reason: "cross_tenant_request" };
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
      if (operation.kind === "reserve") {
        const result = await store.reserve(operation.request, operation.now);
        return result.ok ? { status: "success", value: result } as const : { status: result.error === "concurrency_limit" || result.error === "emergency_stop" ? "safety_blocked" : "unavailable", reason: result.error } as const;
      }
      if (operation.kind === "release") return (await store.release(auth.organizationId, operation.provider, operation.reservationId))
        ? { status: "success", value: true } as const : { status: "unavailable", reason: "release_failed" } as const;
      const result = await store.recordUsage(operation.request, operation.now);
      return result.ok ? { status: "success", value: result } as const : { status: result.error === "budget_exceeded" || result.error === "emergency_stop" ? "safety_blocked" : "unavailable", reason: result.error } as const;
    });
  } catch {
    return { status: "unavailable", reason: "transaction_failed" };
  }
}
