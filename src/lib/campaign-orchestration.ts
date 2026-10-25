import { futureDateTime, resolveLocalDateTime } from "./scheduling";
import { eligibleContacts, type SimCampaign, type SimCallState, type SimContact } from "./campaign-simulation";

export type OrchestrationState = "idle" | "running" | "paused" | "stopped" | "completed";
export type RetryPreview = { attempt: number; delaySeconds: number; outcome: SimCallState };
export type OrchestrationSummary = { total: number; eligible: number; processed: number; remaining: number; completed: number; excluded: number };
export function isCurrentOrchestrationRequest(requestGeneration: number, currentGeneration: number, requestQueue: MockCampaignOrchestrator | null, currentQueue: MockCampaignOrchestrator | null, requestCampaignId: string, currentCampaignId: string) { return requestGeneration === currentGeneration && requestQueue !== null && requestQueue === currentQueue && requestCampaignId === currentCampaignId; }

export function validateOrchestrationSchedule(date: string, time: string, timeZone: string, now = Date.now()) {
  const resolved = resolveLocalDateTime(date, time, timeZone);
  if (!resolved.ok) return resolved;
  return futureDateTime(date, time, timeZone, now) ? resolved : { ok: false as const, error: "Scheduled time must be in the future." };
}

export function buildRetryPreview(outcome: SimCallState, maxAttempts = 2): RetryPreview[] {
  const retryable = new Set<SimCallState>(["no_answer", "busy", "failed"]);
  if (!retryable.has(outcome) || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) return [];
  return Array.from({ length: maxAttempts - 1 }, (_, index) => ({ attempt: index + 2, delaySeconds: 60 * 2 ** index, outcome }));
}

export class MockCampaignOrchestrator {
  state: OrchestrationState = "idle";
  private processed = new Set<string>();
  constructor(readonly campaign: SimCampaign, readonly contacts: SimContact[], readonly organizationId: string) {}

  eligible() { return this.contacts.filter((contact) => eligibleContacts(this.campaign, contact, this.organizationId).eligible); }
  nextUnprocessed() { return this.eligible().find((contact) => !this.processed.has(contact.id)); }
  start() { if (this.state === "running" || this.state === "completed" || this.state === "stopped") return false; if (this.eligible().length === 0) { this.state = "completed"; return false; } this.state = "running"; return true; }
  pause() { if (this.state !== "running") return false; this.state = "paused"; return true; }
  resume() { if (this.state !== "paused") return false; this.state = "running"; return true; }
  stop() { if (this.state === "stopped") return false; this.state = "stopped"; return true; }
  process(contactId: string) {
    if (this.state !== "running") return false;
    const next = this.nextUnprocessed();
    const contact = next?.id === contactId ? next : undefined;
    if (!contact || this.processed.has(contactId)) return false;
    this.processed.add(contactId);
    if (this.processed.size === this.eligible().length) this.state = "completed";
    return true;
  }
  reset() { this.state = "idle"; this.processed.clear(); }
  summary(): OrchestrationSummary { const eligible = this.eligible().length; const processed = this.processed.size; return { total: this.contacts.length, eligible, processed, remaining: Math.max(0, eligible - processed), completed: processed, excluded: this.contacts.length - eligible }; }
}
