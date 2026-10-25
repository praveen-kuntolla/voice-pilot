import { eligibleContacts, type SimCampaign, type SimContact } from "./campaign-simulation";

export type SafetyLimits = { maxConcurrent: number; currentConcurrent: number; maxAttempts: number; attempt: number; maxSpendCents: number; spentCents: number; emergencyStop: boolean };
export function authorizeOfflineAction(campaign: SimCampaign, contact: SimContact | undefined, organizationId: string, limits: SafetyLimits) {
  if (!contact || campaign.organization_id !== organizationId || contact.organization_id !== organizationId) return { ok: false as const, error: "Organization authorization is required." };
  if (limits.emergencyStop) return { ok: false as const, error: "Emergency stop is active." };
  if (!Number.isSafeInteger(limits.maxConcurrent) || limits.maxConcurrent < 0 || limits.currentConcurrent >= limits.maxConcurrent) return { ok: false as const, error: "Concurrency limit reached." };
  if (!Number.isSafeInteger(limits.maxAttempts) || limits.maxAttempts < 1 || !Number.isSafeInteger(limits.attempt) || limits.attempt < 0 || limits.attempt >= limits.maxAttempts) return { ok: false as const, error: "Retry limit reached." };
  if (!Number.isFinite(limits.maxSpendCents) || !Number.isFinite(limits.spentCents) || limits.maxSpendCents < 0 || limits.spentCents < 0 || limits.spentCents >= limits.maxSpendCents) return { ok: false as const, error: "Usage ceiling reached." };
  const eligibility = eligibleContacts(campaign, contact, organizationId); return eligibility.eligible ? { ok: true as const, idempotencyRequired: true } : { ok: false as const, error: eligibility.reason ?? "Consent or calling policy rejected this action." };
}
