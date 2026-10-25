import type { OrchestrationSummary } from "./campaign-orchestration";
import type { TelephonyReadiness } from "./telephony";

export type ReadinessIndicator = { name: string; status: "disabled" | "sandbox" | "ready"; detail: string };

export function readinessIndicators(telephony: TelephonyReadiness = "disabled"): ReadinessIndicator[] {
  return [
    { name: "Telephony", status: telephony === "disabled" ? "disabled" : "sandbox", detail: telephony === "disabled" ? "No calls can be placed." : "Configuration is diagnostic only." },
    { name: "Realtime voice", status: "disabled", detail: "LiveKit sessions are disabled." },
    { name: "AI providers", status: "disabled", detail: "External STT, LLM and TTS providers are disabled." },
  ];
}

export function simulationAnalytics(summary: OrchestrationSummary, qualified: number, callbacks: number, appointments: number) {
  const safeQualified = Math.min(Math.max(qualified, 0), summary.processed);
  return { ...summary, qualified: safeQualified, callbacks: Math.max(0, callbacks), appointments: Math.max(0, appointments), conversionRate: summary.processed === 0 ? 0 : safeQualified / summary.processed };
}
