import { simulationMetrics, type SimEvent } from "./campaign-simulation";

export type SimulationReport = { simulationOnly: true; generatedAt: string; campaignName: string; agentName: string; metrics: ReturnType<typeof simulationMetrics> };

export function buildSimulationReport(events: SimEvent[], selectedCount: number, campaignName: string, agentName: string, generatedAt = new Date().toISOString()): SimulationReport {
  return { simulationOnly: true, generatedAt, campaignName, agentName, metrics: simulationMetrics(events, selectedCount) };
}

export function sanitizeCsvCell(value: string) {
  return /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function simulationReportCsv(report: SimulationReport) {
  const rows = [["SIMULATION ONLY"], ["Campaign", sanitizeCsvCell(report.campaignName)], ["Agent", sanitizeCsvCell(report.agentName)], ["Generated", report.generatedAt], ["Metric", "Value"], ...Object.entries(report.metrics)];
  return rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n");
}
