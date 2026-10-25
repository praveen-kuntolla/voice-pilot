import { simulationMetrics, type SimEvent } from "./campaign-simulation";

export type SimulationReport = { simulationOnly: true; generatedAt: string; campaignName: string; agentName: string; metrics: ReturnType<typeof simulationMetrics> };

export function buildSimulationReport(events: SimEvent[], selectedCount: number, campaignName: string, agentName: string, generatedAt = new Date().toISOString()): SimulationReport {
  return { simulationOnly: true, generatedAt, campaignName, agentName, metrics: simulationMetrics(events, selectedCount) };
}

export function simulationReportCsv(report: SimulationReport) {
  const rows = [["SIMULATION ONLY"], ["Campaign", report.campaignName], ["Agent", report.agentName], ["Generated", report.generatedAt], ["Metric", "Value"], ...Object.entries(report.metrics)];
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
}
