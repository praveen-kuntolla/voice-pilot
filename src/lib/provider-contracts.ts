import { z } from "zod";

export type ProviderFailure = { code: "disabled" | "timeout" | "invalid" | "cancelled" | "unavailable"; message: string; retryable: boolean };
export type ProviderEvent = { sequence: number; sessionId: string; organizationId: string; kind: "started" | "progress" | "completed" | "failed" | "cancelled"; payload: string };
export type ProviderResult = { ok: true; events: ProviderEvent[] } | { ok: false; failure: ProviderFailure };
export type ProviderContext = { sessionId: string; organizationId: string; agentId: string };
export type OfflineProvider = { readonly kind: "telephony" | "livekit" | "stt" | "llm" | "tts"; run(context: ProviderContext, input?: string): Promise<ProviderResult>; cancel(context: ProviderContext): ProviderEvent };

export const providerEventSchema = z.object({ sequence: z.number().int().positive(), sessionId: z.string().min(1), organizationId: z.string().min(1), kind: z.enum(["started", "progress", "completed", "failed", "cancelled"]), payload: z.string() });

export class DeterministicOfflineProvider implements OfflineProvider {
  constructor(readonly kind: OfflineProvider["kind"], private readonly output: string) {}
  async run(context: ProviderContext, input = "") { const events = [{ sequence: 1, ...context, kind: "started" as const, payload: `${this.kind} offline simulation started` }, { sequence: 2, ...context, kind: "progress" as const, payload: input || this.output }, { sequence: 3, ...context, kind: "completed" as const, payload: this.output }]; return { ok: true as const, events } satisfies ProviderResult; }
  cancel(context: ProviderContext) { return { sequence: 1, ...context, kind: "cancelled" as const, payload: `${this.kind} offline simulation cancelled` }; }
}

export function offlineProviderSet() { return { telephony: new DeterministicOfflineProvider("telephony", "No call was placed."), livekit: new DeterministicOfflineProvider("livekit", "No room was joined."), stt: new DeterministicOfflineProvider("stt", "Mock transcript."), llm: new DeterministicOfflineProvider("llm", "Mock response."), tts: new DeterministicOfflineProvider("tts", "No audio was generated.") }; }
