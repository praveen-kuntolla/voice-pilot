import { describe, expect, it } from "vitest";
import { readinessIndicators, simulationAnalytics } from "@/lib/platform-readiness";

describe("platform readiness", () => {
  it("truthfully distinguishes disabled providers from tested offline contracts", () => { const indicators = readinessIndicators(); expect(indicators.find((item) => item.name === "Telephony")?.status).toBe("disabled"); expect(indicators.find((item) => item.name === "Offline contracts")?.status).toBe("contract-tested"); });
  it("does not present durable controls as active production enforcement", () => { expect(readinessIndicators().find((item) => item.name === "Durable safety controls")).toMatchObject({ status: "unverified" }); });
  it("distinguishes disposable-local database tests from deployed controls", () => { const item = readinessIndicators().find((entry) => entry.name === "Local PostgreSQL safety"); expect(item?.status).toBe("contract-tested"); expect(item?.detail).toContain("review-only"); });
  it("keeps simulated analytics bounded and avoids invalid numbers", () => { const result = simulationAnalytics({ total: 2, eligible: 0, processed: 0, remaining: 0, completed: 0, excluded: 2 }, 4, 1, 1); expect(result.qualified).toBe(0); expect(result.callbacks).toBe(0); expect(result.conversionRate).toBe(0); const bounded = simulationAnalytics({ total: 4, eligible: 4, processed: 2, remaining: 2, completed: 2, excluded: 0 }, 8, 9, 9); expect(bounded.callbacks).toBe(2); expect(bounded.conversionRate).toBe(1); });
});
