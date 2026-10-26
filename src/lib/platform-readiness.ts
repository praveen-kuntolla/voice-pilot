import type { OrchestrationSummary } from "./campaign-orchestration";
import type { TelephonyReadiness } from "./telephony";

export type ReadinessIndicator = { name: string; status: "disabled" | "sandbox" | "mock" | "contract-tested" | "missing-config" | "unverified"; detail: string };

export function readinessIndicators(telephony: TelephonyReadiness = "disabled"): ReadinessIndicator[] {
  return [
    { name: "Telephony", status: telephony === "disabled" ? "disabled" : "sandbox", detail: telephony === "disabled" ? "No calls can be placed." : "Configuration is diagnostic only." },
    { name: "Offline contracts", status: "contract-tested", detail: "Deterministic provider lifecycle adapters are locally tested." },
    { name: "Realtime voice", status: "disabled", detail: "LiveKit sessions are disabled; credentials and production controls are missing." },
    { name: "AI providers", status: "disabled", detail: "External STT, LLM and TTS providers are disabled; webhook infrastructure is unverified." },
    { name: "Durable safety controls", status: "unverified", detail: "Transactional replay, reservations, emergency stop and usage-ledger design is review-only; production storage is not active." },
    { name: "Offline safety tests", status: "contract-tested", detail: "Deterministic replay, concurrency, budget and tenant-bound control behavior is locally tested." },
    { name: "Local PostgreSQL safety", status: "contract-tested", detail: "Transactional safety routines have disposable-local PostgreSQL tests; migrations 012–013 are review-only and no production controls are deployed." },
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
