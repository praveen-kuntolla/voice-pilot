import { describe, expect, it } from "vitest";
import { evaluateOfflineAgent } from "@/lib/offline-agent-evaluation";

describe("offline agent evaluation", () => {
  it("reports deterministic configuration and lifecycle warnings", () => {
    const result = evaluateOfflineAgent({ instructions: "", language: "fr-FR", voiceId: "safe-demo", simulationState: "failed", turns: 1, preflightAllowed: false });
    expect(result.synthetic).toBe(true);
    expect(result.ruleBased).toBe(true);
    expect(result.warnings).toEqual(expect.arrayContaining(["System instructions are missing.", "The mock voice and agent language need compatibility review.", "Server preflight was not authorized."]));
  });

  it("returns a clean completed evaluation without quality scoring", () => {
    const result = evaluateOfflineAgent({ instructions: "Be concise.", language: "en-US", voiceId: "safe-demo", simulationState: "ended", turns: 2, preflightAllowed: true });
    expect(result.warnings).toEqual([]);
    expect(result).not.toHaveProperty("score");
  });
});
