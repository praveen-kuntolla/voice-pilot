import { describe, expect, it } from "vitest";
import { readinessIndicators, simulationAnalytics } from "@/lib/platform-readiness";

describe("platform readiness", () => {
  it("truthfully reports disabled integrations", () => { expect(readinessIndicators().every((item) => item.status === "disabled")).toBe(true); });
  it("keeps simulated analytics bounded and avoids invalid numbers", () => { const result = simulationAnalytics({ total: 2, eligible: 0, processed: 0, remaining: 0, completed: 0, excluded: 2 }, 4, 1, 1); expect(result.qualified).toBe(0); expect(result.callbacks).toBe(0); expect(result.conversionRate).toBe(0); const bounded = simulationAnalytics({ total: 4, eligible: 4, processed: 2, remaining: 2, completed: 2, excluded: 0 }, 8, 9, 9); expect(bounded.callbacks).toBe(2); expect(bounded.conversionRate).toBe(1); });
});
