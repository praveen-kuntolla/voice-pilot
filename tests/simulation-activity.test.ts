import { describe, expect, it } from "vitest";
import {
  activityKey, filterSyntheticActivity, isSyntheticActivity,
  sanitizeActivity, syntheticActivityJson, syntheticActivityMetrics,
  type SyntheticActivity,
} from "@/lib/simulation-activity";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const now = Date.parse("2026-10-29T12:00:00.000Z");

function sample(partial: Partial<SyntheticActivity> = {}): SyntheticActivity {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    observedAt: "2026-10-29T11:00:00.000Z",
    state: "completed",
    outcome: "callback_requested",
    ...partial,
  };
}

describe("redacted synthetic browser-tab activity", () => {
  it("uses organization-separated storage keys and rejects malformed scope", () => {
    expect(activityKey(orgA)).not.toBe(activityKey(orgB));
    expect(() => activityKey("not-an-org")).toThrow("invalid_organization");
  });

  it("accepts only bounded, valid synthetic terminal state/outcome records", () => {
    expect(isSyntheticActivity(sample(), now)).toBe(true);
    expect(isSyntheticActivity(sample({ state: "simulated_dialing" as SyntheticActivity["state"] }), now)).toBe(false);
    expect(isSyntheticActivity(sample({ observedAt: "2025-01-01T00:00:00.000Z" }), now)).toBe(false);
    expect(isSyntheticActivity(sample({ outcome: "real_call" as SyntheticActivity["outcome"] }), now)).toBe(false);
    expect(sanitizeActivity([sample(), { ...sample(), phone: "+1-555-123-4567", contactId: "private", transcript: "hello" }], now)).toEqual([sample(), sample()]);
  });

  it("caps retained records and never imports arbitrary fields", () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({
      ...sample(), id: i.toString(16).padStart(8, "0") + "-3333-4333-8333-333333333333", email: "hidden@example.org",
    }));
    const safe = sanitizeActivity(rows, now);
    expect(safe).toHaveLength(200);
    expect(JSON.stringify(safe)).not.toContain("hidden@example.org");
  });

  it("filters by date and outcome and computes honest zero metrics", () => {
    const records = [sample(), sample({
      id: "44444444-4444-4444-8444-444444444444",
      observedAt: "2026-10-20T11:00:00.000Z",
      state: "no_answer", outcome: "no_answer",
    })];
    expect(filterSyntheticActivity(records, { days: 7, outcome: "all" }, now)).toHaveLength(1);
    expect(filterSyntheticActivity(records, { days: 30, outcome: "no_answer" }, now)).toHaveLength(1);
    expect(syntheticActivityMetrics(records)).toMatchObject({
      total: 2, completed: 1, callbacks: 1, noAnswer: 1, completionRate: 50,
    });
    expect(syntheticActivityMetrics([])).toMatchObject({ total: 0, completed: 0, completionRate: 0 });
  });

  it("exports only synthetic dates/states/outcomes without personal identifiers", () => {
    const report = syntheticActivityJson([{
      ...sample(), contactId: "secret-contact", name: "Do not export", phone: "+123456789", transcript: "private",
    } as SyntheticActivity]);
    expect(JSON.parse(report)).toMatchObject({
      simulationOnly: true, source: "browser_tab_only",
      metrics: { total: 1, completed: 1 },
      records: [{ state: "completed", outcome: "callback_requested" }],
    });
    expect(report).not.toMatch(/contactId|secret-contact|phone|transcript|Do not export|\+123456789/);
  });
});
