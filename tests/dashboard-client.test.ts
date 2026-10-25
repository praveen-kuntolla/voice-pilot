import { describe, expect, it } from "vitest";
import { summarizeDashboardCounts } from "@/components/dashboard-client";

describe("dashboard configuration counts", () => {
  it("counts only organization-scoped configuration and granted non-opted-out contacts", () => {
    expect(summarizeDashboardCounts([{ id: "a" }], [{ id: "c" }, { id: "d" }], [
      { id: "1", consent_status: "granted", opted_out_at: null },
      { id: "2", consent_status: "granted", opted_out_at: "2026-01-01" },
      { id: "3", consent_status: "unknown", opted_out_at: null },
    ])).toEqual({ agents: 1, campaigns: 2, contacts: 3, consented: 1 });
  });
  it("returns honest empty configuration counts", () => {
    expect(summarizeDashboardCounts()).toEqual({ agents: 0, campaigns: 0, contacts: 0, consented: 0 });
  });
});
