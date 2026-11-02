import { describe, expect, it } from "vitest";
import { MockCampaignSimulation, simulationMetrics } from "@/lib/campaign-simulation";
import { buildSimulationReport, simulationReportCsv } from "@/lib/simulation-report";

describe("offline rehearsal results", () => {
  it("keeps synthetic lifecycle results bounded and resettable", () => {
    const simulation = new MockCampaignSimulation({ id: "campaign", organization_id: "org", agent_id: "agent", status: "draft", consent_required: true }, [{ id: "contact", name: "Synthetic contact", organization_id: "org", consent_status: "granted" }], "org");
    simulation.start("interested", { service: "Synthetic service" });
    expect(simulation.events.length).toBeGreaterThan(0);
    expect(simulationMetrics(simulation.events, 1).processed).toBeLessThanOrEqual(1);
    simulation.reset();
    expect(simulation.events).toHaveLength(0);
    expect(simulation.state).toBe("idle");
  });
  it("exports only simulation metrics, never contact identifiers", () => {
    const report = buildSimulationReport([{ contactId: "real-contact-id", state: "completed", message: "Synthetic outcome" }], 1, "Draft", "Agent");
    const csv = simulationReportCsv(report);
    expect(report.simulationOnly).toBe(true);
    expect(csv).toContain("SIMULATION ONLY");
    expect(csv).not.toContain("real-contact-id");
  });
});
