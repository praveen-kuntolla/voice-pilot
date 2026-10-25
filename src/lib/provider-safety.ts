import { eligibleContacts, type SimCampaign, type SimContact } from "./campaign-simulation";

export type SafetyLimits = { maxConcurrent: number; currentConcurrent: number; maxAttempts: number; attempt: number; maxSpendCents: number; spentCents: number; emergencyStop: boolean };
export type CallingHoursPolicy = { timeZone: string; startHour: number; endHour: number; at: number };
function validInteger(value: number, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function withinCallingHours(policy: CallingHoursPolicy) { if (!validInteger(policy.at) || !validInteger(policy.startHour) || !validInteger(policy.endHour) || policy.startHour > 23 || policy.endHour > 24 || policy.startHour >= policy.endHour || !policy.timeZone.trim()) return false; try { const parts = new Intl.DateTimeFormat("en-US", { timeZone: policy.timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(policy.at)); const hour = Number(parts.find((part) => part.type === "hour")?.value); return Number.isInteger(hour) && hour >= policy.startHour && hour < policy.endHour; } catch { return false; } }
export function authorizeOfflineAction(campaign: SimCampaign, contact: SimContact | undefined, organizationId: string, limits: SafetyLimits, callingHours?: CallingHoursPolicy) {
  if (!organizationId.trim() || !contact?.name?.trim() || campaign.organization_id !== organizationId || contact.organization_id !== organizationId) return { ok: false as const, error: "Organization authorization is required." };
  if (typeof limits.emergencyStop !== "boolean") return { ok: false as const, error: "Emergency-stop state is invalid." };
  if (limits.emergencyStop) return { ok: false as const, error: "Emergency stop is active." };
  if (!validInteger(limits.maxConcurrent, 1) || !validInteger(limits.currentConcurrent) || limits.currentConcurrent >= limits.maxConcurrent) return { ok: false as const, error: "Concurrency limit reached." };
  if (!validInteger(limits.maxAttempts, 1) || !validInteger(limits.attempt) || limits.attempt >= limits.maxAttempts) return { ok: false as const, error: "Retry limit reached." };
  if (!validInteger(limits.maxSpendCents, 1) || !validInteger(limits.spentCents) || limits.spentCents >= limits.maxSpendCents) return { ok: false as const, error: "Usage ceiling reached." };
  if (contact.consent_status !== "granted" || contact.opted_out_at || contact.opt_out) return { ok: false as const, error: "Explicit consent is required." };
  if (!callingHours || !withinCallingHours(callingHours)) return { ok: false as const, error: "Calling-hours policy rejected or was unavailable." };
  const eligibility = eligibleContacts(campaign, contact, organizationId); return eligibility.eligible ? { ok: true as const, idempotencyRequired: true } : { ok: false as const, error: eligibility.reason ?? "Consent or calling policy rejected this action." };
}
