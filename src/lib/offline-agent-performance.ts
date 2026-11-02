import { evaluateOfflineAgent } from "@/lib/offline-agent-evaluation";
import type { VoiceEvent } from "@/lib/voice-runtime";

export const OFFLINE_PERFORMANCE_VERSION = 1 as const;
export const OFFLINE_PERFORMANCE_EVENT = "voicepilot:offline-agent-performance";
export type OfflineEvaluationTurnOutcome = "completed" | "failed" | "interrupted";
export type OfflineEvaluationTurn = { turn: number; outcome: OfflineEvaluationTurnOutcome; completedAt: string };
export type OfflineEvaluationSnapshot = {
  version: typeof OFFLINE_PERFORMANCE_VERSION;
  organizationId: string;
  agentId: string;
  hasInstructions: boolean;
  language: string;
  voiceId: string | null;
  state: string;
  turns: number;
  preflightAllowed: boolean;
  outcomes: OfflineEvaluationTurn[];
  updatedAt: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function offlinePerformanceKey(organizationId: string, agentId: string) {
  if (!uuid.test(organizationId) || !uuid.test(agentId)) throw new Error("invalid_offline_performance_identity");
  return `voicepilot:offline-agent-performance:v1:${organizationId}:${agentId}`;
}

function validOutcome(value: unknown): value is OfflineEvaluationTurnOutcome {
  return value === "completed" || value === "failed" || value === "interrupted";
}

export function sanitizeOfflineEvaluationSnapshot(value: unknown, now = Date.now()): OfflineEvaluationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.version !== OFFLINE_PERFORMANCE_VERSION || typeof item.organizationId !== "string" || !uuid.test(item.organizationId)
    || typeof item.agentId !== "string" || !uuid.test(item.agentId) || typeof item.hasInstructions !== "boolean"
    || typeof item.language !== "string" || item.language.length > 20 || (item.voiceId !== null && typeof item.voiceId !== "string")
    || typeof item.state !== "string" || typeof item.turns !== "number" || !Number.isSafeInteger(item.turns) || item.turns < 0 || item.turns > 8
    || typeof item.preflightAllowed !== "boolean" || typeof item.updatedAt !== "string") return null;
  const updatedAt = Date.parse(item.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 60_000) return null;
  if (!Array.isArray(item.outcomes) || item.outcomes.length > 8) return null;
  const outcomes = item.outcomes.filter((entry): entry is OfflineEvaluationTurn => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const turn = entry as Record<string, unknown>;
    const completedAt = typeof turn.completedAt === "string" ? Date.parse(turn.completedAt) : NaN;
    return typeof turn.turn === "number" && Number.isSafeInteger(turn.turn) && turn.turn > 0 && turn.turn <= 8
      && validOutcome(turn.outcome) && Number.isFinite(completedAt) && completedAt <= now + 60_000;
  });
  if (outcomes.length !== item.outcomes.length) return null;
  return { version: OFFLINE_PERFORMANCE_VERSION, organizationId: item.organizationId, agentId: item.agentId, hasInstructions: item.hasInstructions, language: item.language, voiceId: item.voiceId as string | null, state: item.state, turns: item.turns, preflightAllowed: item.preflightAllowed, outcomes, updatedAt: item.updatedAt };
}

export function readOfflineEvaluationSnapshot(organizationId: string, agentId: string): OfflineEvaluationSnapshot | null {
  try {
    const snapshot = sanitizeOfflineEvaluationSnapshot(JSON.parse(sessionStorage.getItem(offlinePerformanceKey(organizationId, agentId)) ?? "null"));
    return snapshot?.organizationId === organizationId && snapshot.agentId === agentId ? snapshot : null;
  } catch { return null; }
}

export function writeOfflineEvaluationSnapshot(snapshot: OfflineEvaluationSnapshot) {
  try { sessionStorage.setItem(offlinePerformanceKey(snapshot.organizationId, snapshot.agentId), JSON.stringify(snapshot)); } catch { /* Browser storage is optional for the local demo. */ }
}

export function clearOfflineEvaluationSnapshot(organizationId: string, agentId: string) {
  try { sessionStorage.removeItem(offlinePerformanceKey(organizationId, agentId)); } catch { /* Best effort only. */ }
}

export function turnOutcomes(events: readonly VoiceEvent[]): OfflineEvaluationTurn[] {
  const byTurn = new Map<number, VoiceEvent[]>();
  for (const event of events) if (event.turnId > 0) byTurn.set(event.turnId, [...(byTurn.get(event.turnId) ?? []), event]);
  return [...byTurn.entries()].sort(([a], [b]) => a - b).flatMap(([turn, turnEvents]) => {
    const outcome = turnEvents.some((event) => event.state === "failed") ? "failed" : turnEvents.some((event) => event.state === "interrupted") ? "interrupted" : turnEvents.some((event) => event.state === "idle") ? "completed" : null;
    return outcome ? [{ turn, outcome, completedAt: new Date().toISOString() }] : [];
  });
}

export function summarizeOfflinePerformance(snapshot: OfflineEvaluationSnapshot) {
  const evaluation = evaluateOfflineAgent({ instructions: snapshot.hasInstructions ? "configured" : "", language: snapshot.language, voiceId: snapshot.voiceId, simulationState: snapshot.state, turns: snapshot.turns, preflightAllowed: snapshot.preflightAllowed });
  const completed = snapshot.outcomes.filter((item) => item.outcome === "completed").length;
  const failed = snapshot.outcomes.filter((item) => item.outcome === "failed").length;
  const interrupted = snapshot.outcomes.filter((item) => item.outcome === "interrupted").length;
  const score = Math.max(0, 100 - evaluation.warnings.length * 20);
  return { evaluation, score, completed, failed, interrupted, total: snapshot.outcomes.length, completionRate: snapshot.outcomes.length ? Math.round((completed / snapshot.outcomes.length) * 100) : 0 };
}
