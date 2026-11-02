import { describe, expect, it } from "vitest";
import { sanitizeOfflineEvaluationSnapshot, summarizeOfflinePerformance, turnOutcomes, type OfflineEvaluationSnapshot } from "@/lib/offline-agent-performance";

const ids = { organizationId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222" };
const snapshot: OfflineEvaluationSnapshot = { version: 1, ...ids, hasInstructions: true, language: "en-US", voiceId: "safe-demo", state: "idle", turns: 2, preflightAllowed: true, outcomes: [{ turn: 1, outcome: "completed", completedAt: "2026-01-01T00:00:00.000Z" }, { turn: 2, outcome: "failed", completedAt: "2026-01-01T00:01:00.000Z" }], updatedAt: "2026-01-01T00:01:00.000Z" };

describe("offline agent performance", () => {
  it("summarizes deterministic synthetic completion and failure counts", () => {
    expect(summarizeOfflinePerformance(snapshot)).toMatchObject({ score: 100, completed: 1, failed: 1, interrupted: 0, total: 2, completionRate: 50 });
  });

  it("classifies warning categories through the existing evaluation rules", () => {
    const result = summarizeOfflinePerformance({ ...snapshot, hasInstructions: false, preflightAllowed: false, state: "failed" });
    expect(result.evaluation.warnings).toEqual(expect.arrayContaining(["System instructions are missing.", "Server preflight was not authorized."]));
    expect(result.score).toBeLessThan(100);
  });

  it("rejects cross-tenant or malformed browser snapshots", () => {
    expect(sanitizeOfflineEvaluationSnapshot({ ...snapshot, organizationId: "not-a-uuid" })).toBeNull();
    expect(sanitizeOfflineEvaluationSnapshot({ ...snapshot, outcomes: [{ turn: 9, outcome: "completed", completedAt: snapshot.updatedAt }] })).toBeNull();
  });

  it("derives interrupted turns without leaking event text", () => {
    const outcomes = turnOutcomes([
      { sequence: 1, state: "speaking", kind: "state", text: "private synthetic text", turnId: 1 },
      { sequence: 2, state: "interrupted", kind: "diagnostic", text: "stale output suppressed", turnId: 1 },
      { sequence: 3, state: "idle", kind: "diagnostic", text: "ready", turnId: 1 },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("interrupted");
    expect(JSON.stringify(outcomes)).not.toContain("private synthetic text");
  });
});
