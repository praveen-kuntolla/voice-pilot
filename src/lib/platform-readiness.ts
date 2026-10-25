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
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const processed = Math.floor(finite(summary.processed));
  const safeQualified = Math.min(Math.floor(finite(qualified)), processed);
  const safeCallbacks = Math.min(Math.floor(finite(callbacks)), processed);
  const safeAppointments = Math.min(Math.floor(finite(appointments)), processed);
  return { ...summary, processed, qualified: safeQualified, callbacks: safeCallbacks, appointments: safeAppointments, conversionRate: processed === 0 ? 0 : Math.min(1, Math.max(0, safeQualified / processed)) };
}
