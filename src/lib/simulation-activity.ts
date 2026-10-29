/** Browser-tab-only synthetic outcome summaries. Never store contacts, IDs,
 * agent/campaign names, phone numbers, transcripts, or provider data. */
import type { MockOutcome, SimEvent } from "./campaign-simulation";

export type ActivityOutcome = MockOutcome | "skipped";
export type ActivityState = "completed" | "no_answer" | "busy" | "failed" | "skipped";
export type SyntheticActivity = {
  id: string;
  observedAt: string;
  state: ActivityState;
  outcome: ActivityOutcome;
};

export const ACTIVITY_EVENT = "voicepilot:synthetic-activity";
export const MAX_ACTIVITY = 200;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const STATES: readonly ActivityState[] = ["completed", "no_answer", "busy", "failed", "skipped"];
const OUTCOMES: readonly ActivityOutcome[] = [
  "interested", "not_interested", "callback_requested", "appointment_requested",
  "no_answer", "busy", "wrong_number", "opted_out", "error", "skipped",
];
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function activityKey(organizationId: string) {
  if (!isUuid(organizationId)) throw new Error("invalid_organization");
  return `voicepilot:synthetic-outcomes:v1:${organizationId}`;
}

export function isSyntheticActivity(value: unknown, now = Date.now()): value is SyntheticActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const when = typeof item.observedAt === "string" ? Date.parse(item.observedAt) : NaN;
  return typeof item.id === "string" && /^[a-f0-9-]{36}$/i.test(item.id)
    && typeof item.state === "string" && STATES.includes(item.state as ActivityState)
    && typeof item.outcome === "string" && OUTCOMES.includes(item.outcome as ActivityOutcome)
    && Number.isFinite(when) && when <= now + 60_000 && when >= now - RETENTION_MS;
}

export function sanitizeActivity(value: unknown, now = Date.now()): SyntheticActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SyntheticActivity => isSyntheticActivity(item, now))
    .map(({ id, observedAt, state, outcome }) => ({ id, observedAt, state, outcome }))
    .slice(-MAX_ACTIVITY);
}

export function readSyntheticActivity(organizationId: string): SyntheticActivity[] {
  try {
    return sanitizeActivity(JSON.parse(sessionStorage.getItem(activityKey(organizationId)) ?? "[]"));
  } catch {
    return [];
  }
}

export function appendSyntheticActivity(organizationId: string, events: readonly Pick<SimEvent, "state" | "outcome">[]) {
  if (typeof window === "undefined" || !isUuid(organizationId)) return 0;
  const accepted: SyntheticActivity[] = [];
  for (const event of events) {
    if (!STATES.includes(event.state as ActivityState)) continue;
    const outcome = event.state === "skipped" ? "skipped" : event.outcome;
    if (!outcome || !OUTCOMES.includes(outcome)) continue;
    accepted.push({
      id: crypto.randomUUID(),
      observedAt: new Date().toISOString(),
      state: event.state as ActivityState,
      outcome,
    });
  }
  if (accepted.length === 0) return 0;
  try {
    const next = sanitizeActivity([...readSyntheticActivity(organizationId), ...accepted]);
    sessionStorage.setItem(activityKey(organizationId), JSON.stringify(next));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
    return accepted.length;
  } catch {
    // Storage denial must not affect or enable a simulation action.
    return 0;
  }
}

export function clearSyntheticActivity(organizationId: string) {
  try {
    sessionStorage.removeItem(activityKey(organizationId));
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
  } catch {
    // No effect outside this browser tab.
  }
}

/** Remove redacted synthetic tab data when signing out of the workspace. */
export function clearAllSyntheticActivity() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("voicepilot:synthetic-outcomes:v1:")) sessionStorage.removeItem(key);
    }
    window.dispatchEvent(new Event(ACTIVITY_EVENT));
  } catch {
    // Browser storage access is best effort and contains no identifying data.
  }
}

export function filterSyntheticActivity(
  records: readonly SyntheticActivity[],
  selection: { outcome?: string; days?: number },
  now = Date.now(),
) {
  const duration = selection.days && Number.isFinite(selection.days) && selection.days > 0
    ? selection.days * 86_400_000 : Infinity;
  return records.filter((record) => (!selection.outcome || selection.outcome === "all" || record.outcome === selection.outcome)
    && now - Date.parse(record.observedAt) <= duration);
}

export function syntheticActivityMetrics(records: readonly SyntheticActivity[]) {
  const total = records.length;
  const completed = records.filter((record) => record.state === "completed").length;
  const excluded = records.filter((record) => record.state === "skipped").length;
  const interested = records.filter((record) => record.outcome === "interested").length;
  const callbacks = records.filter((record) => record.outcome === "callback_requested").length;
  const appointments = records.filter((record) => record.outcome === "appointment_requested").length;
  const noAnswer = records.filter((record) => record.outcome === "no_answer").length;
  const busy = records.filter((record) => record.outcome === "busy").length;
  const failed = records.filter((record) => record.state === "failed").length;
  return { total, completed, excluded, interested, callbacks, appointments, noAnswer, busy, failed,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

export function syntheticActivityJson(records: readonly SyntheticActivity[]) {
  return JSON.stringify({
    simulationOnly: true,
    source: "browser_tab_only",
    generatedAt: new Date().toISOString(),
    records: records.map(({ observedAt, state, outcome }) => ({ observedAt, state, outcome })),
    metrics: syntheticActivityMetrics(records),
  }, null, 2);
}
