import { describe, expect, it } from "vitest";
import { buildSimulationReport, simulationReportCsv } from "@/lib/simulation-report";

describe("simulation reports", () => {
  it("labels exports as simulation-only and reports bounded synthetic metrics", () => {
    const report = buildSimulationReport([{ contactId: "c1", state: "completed", outcome: "interested", message: "synthetic" }], 1, "Campaign", "Agent", "2026-01-01T00:00:00.000Z");
    expect(report.simulationOnly).toBe(true);
    expect(report.metrics.processed).toBe(1);
    expect(report.metrics.qualified).toBe(0);
    expect(simulationReportCsv(report)).toContain("SIMULATION ONLY");
    expect(simulationReportCsv(report)).not.toContain("c1");
  });

  it("handles empty reports without invalid rates or records", () => {
    const report = buildSimulationReport([], 0, "Empty", "Mock");
    expect(report.metrics.remaining).toBe(0);
    expect(report.metrics.processed).toBe(0);
    expect(simulationReportCsv(report)).toContain('"processed","0"');
  });
});
