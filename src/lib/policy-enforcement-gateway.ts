import { authorizeOfflineAction, type CallingHoursPolicy, type SafetyLimits } from "@/lib/provider-safety";
import type { SimCampaign, SimContact } from "@/lib/campaign-simulation";
import type { DurableSafetyStore } from "@/lib/durable-safety";
import { authorizeTrustedActor, type TrustedIdentitySource } from "@/lib/trusted-authorization";

export type AuthoritativePolicyContext = {
  organizationId: string;
  campaign: SimCampaign;
  contact: SimContact;
  agent: { id: string; organization_id: string; enabled: boolean };
  provider: string;
  limits: SafetyLimits;
  callingHours: Omit<CallingHoursPolicy, "at">;
  maxPerMinute: number;
  estimatedCostCents: number;
};

export interface PolicyContextRepository {
  load(input: { organizationId: string; campaignId: string; agentId: string; contactId: string }): Promise<AuthoritativePolicyContext | null>;
  claimRateLimit(input: { organizationId: string; provider: string; limit: number; now: number }): Promise<boolean>;
}
export type PolicyDecision =
  | { ok: true; actorId: string; organizationId: string; idempotencyKey: string; checkedAt: number; execution: { provider: string; maxConcurrent: number; amountCents: number; budgetCents: number } }
  | { ok: false; category: "denied" | "unavailable" | "safety_blocked"; reason: string };

const required = (value: string) => typeof value === "string" && value.trim().length > 0 && value.length <= 256;

export async function authorizeProviderAction(deps: {
  identity: TrustedIdentitySource;
  repository: PolicyContextRepository;
  safety: DurableSafetyStore;
  now: () => number;
  idempotencyTtlMs?: number;
  bindVerifiedContext?: (identity: { actorId: string; organizationId: string }) => Promise<void>;
}, input: { organizationId: string; campaignId: string; agentId: string; contactId: string; idempotencyKey: string; claimedActorId?: string }): Promise<PolicyDecision> {
  const now = deps.now();
  if (!Number.isSafeInteger(now) || now < 0 || !required(input.idempotencyKey)) return { ok: false, category: "denied", reason: "invalid_request" };
  const auth = await authorizeTrustedActor(deps.identity, { organizationId: input.organizationId, operation: "execute_privileged", claimedActorId: input.claimedActorId }, now);
  if (!auth.ok) return { ok: false, category: "denied", reason: auth.reason };
  try { await deps.bindVerifiedContext?.({ actorId: auth.actorId, organizationId: auth.organizationId }); }
  catch { return { ok: false, category: "unavailable", reason: "request_context_unavailable" }; }
  let context: AuthoritativePolicyContext | null;
  try { context = await deps.repository.load(input); }
  catch { return { ok: false, category: "unavailable", reason: "policy_context_unavailable" }; }
  if (!context) return { ok: false, category: "denied", reason: "resource_not_found" };
  if (context.organizationId !== auth.organizationId || context.campaign.organization_id !== auth.organizationId || context.contact.organization_id !== auth.organizationId || context.agent.organization_id !== auth.organizationId || context.campaign.agent_id !== context.agent.id || context.agent.id !== input.agentId || context.campaign.id !== input.campaignId || context.contact.id !== input.contactId || !context.agent.enabled) return { ok: false, category: "denied", reason: "resource_authorization_failed" };
  let global: Awaited<ReturnType<DurableSafetyStore["getGlobalControl"]>>;
  let organization: Awaited<ReturnType<DurableSafetyStore["getControl"]>>;
  try { [global, organization] = await Promise.all([deps.safety.getGlobalControl(), deps.safety.getControl(auth.organizationId)]); }
  catch { return { ok: false, category: "unavailable", reason: "safety_control_unavailable" }; }
  if (!global || !organization) return { ok: false, category: "unavailable", reason: "required_control_missing" };
  if (global.emergencyStop || organization.emergencyStop) return { ok: false, category: "safety_blocked", reason: "emergency_stop" };
  let offline: ReturnType<typeof authorizeOfflineAction>;
  try { offline = authorizeOfflineAction(context.campaign, context.contact, auth.organizationId, context.limits, { ...context.callingHours, at: now }); }
  catch { return { ok: false, category: "unavailable", reason: "policy_evaluation_failed" }; }
  if (!offline.ok) return { ok: false, category: "safety_blocked", reason: offline.error };
  if (!required(context.provider) || !Number.isSafeInteger(context.maxPerMinute) || context.maxPerMinute < 1 || !Number.isSafeInteger(context.estimatedCostCents) || context.estimatedCostCents < 0) return { ok: false, category: "unavailable", reason: "authoritative_limits_unavailable" };
  try {
    if (!(await deps.repository.claimRateLimit({ organizationId: auth.organizationId, provider: context.provider, limit: context.maxPerMinute, now }))) return { ok: false, category: "safety_blocked", reason: "rate_limit_reached" };
    const ttl = deps.idempotencyTtlMs ?? 300_000;
    const expiresAt = now + ttl;
    if (!Number.isSafeInteger(ttl) || ttl < 1 || !Number.isSafeInteger(expiresAt) || !(await deps.safety.claimReplay({ organizationId: auth.organizationId, provider: context.provider, eventId: `action:${input.idempotencyKey}`, expiresAt }, now))) return { ok: false, category: "safety_blocked", reason: "duplicate_idempotency_key" };
  } catch { return { ok: false, category: "unavailable", reason: "policy_claim_failed" }; }
  return { ok: true, actorId: auth.actorId, organizationId: auth.organizationId, idempotencyKey: input.idempotencyKey, checkedAt: now, execution: { provider: context.provider, maxConcurrent: context.limits.maxConcurrent, amountCents: context.estimatedCostCents, budgetCents: context.limits.maxSpendCents } };
}
