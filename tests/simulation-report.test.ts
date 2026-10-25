import { describe, expect, it } from "vitest";
import { buildSimulationReport, sanitizeCsvCell, simulationReportCsv } from "@/lib/simulation-report";

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

  it("neutralizes spreadsheet formulas while preserving CSV quoting", () => {
    const report = buildSimulationReport([], 0, " =SUM(A1), \"Campaign\"\nNext", "@Agent", "2026-01-01T00:00:00.000Z");
    const csv = simulationReportCsv(report);
    expect(sanitizeCsvCell("+formula")).toBe("'+formula");
    expect(sanitizeCsvCell("-formula")).toBe("'-formula");
    expect(sanitizeCsvCell("safe-name")).toBe("safe-name");
    expect(csv).toContain(`"' =SUM(A1), ""Campaign""`);
    expect(csv).toContain(`"'@Agent"`);
    expect(csv).toContain("SIMULATION ONLY");
    expect(csv).not.toContain("contactId");
    expect(csv).not.toContain("phone");
    expect(csv).not.toContain("email");
  });
});
