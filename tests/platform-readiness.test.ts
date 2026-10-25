import { describe, expect, it } from "vitest";
import { readinessIndicators, simulationAnalytics } from "@/lib/platform-readiness";

describe("platform readiness", () => {
  it("truthfully reports disabled integrations", () => { expect(readinessIndicators().every((item) => item.status === "disabled")).toBe(true); });
  it("keeps simulated analytics bounded and avoids division by zero", () => { const result = simulationAnalytics({ total: 2, eligible: 0, processed: 0, remaining: 0, completed: 0, excluded: 2 }, 4, 1, 1); expect(result.qualified).toBe(0); expect(result.conversionRate).toBe(0); });
});
