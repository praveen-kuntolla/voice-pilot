import { z } from "zod";
import { OfflineCallLifecycle, type CallRecord } from "./call-lifecycle";

export const offlineSandboxConfigSchema = z.object({
  transport: z.literal("mock"), stt: z.literal("mock"), llm: z.literal("mock"), tts: z.literal("mock"),
  microphoneEnabled: z.literal(false), providerRequestsEnabled: z.literal(false), simulationOnly: z.literal(true),
});
export type OfflineSandboxConfig = z.infer<typeof offlineSandboxConfigSchema>;
export const defaultOfflineSandboxConfig: OfflineSandboxConfig = { transport: "mock", stt: "mock", llm: "mock", tts: "mock", microphoneEnabled: false, providerRequestsEnabled: false, simulationOnly: true };

export type SandboxEvent =
  | { type: "stt.partial" | "stt.final"; sequence: number; text: string }
  | { type: "llm.started" | "llm.delta" | "llm.completed"; sequence: number; text: string }
  | { type: "tts.started" | "tts.audio" | "tts.completed"; sequence: number; text: string }
  | { type: "session.cancelled" | "session.failed"; sequence: number; reason: "cancelled" | "timeout" | "provider_failure" | "authorization_denied" };

export type SandboxFailure = { code: "cancelled" | "timeout" | "authorization_denied" | "disabled"; message: string };
export type SandboxResult = { ok: true; events: SandboxEvent[]; usage: { inputCharacters: number; outputCharacters: number; syntheticAudioChunks: number } } | { ok: false; failure: SandboxFailure };
type SandboxEventInput = { type: Exclude<SandboxEvent["type"], "session.cancelled" | "session.failed">; text: string } | { type: "session.cancelled" | "session.failed"; reason: "cancelled" | "timeout" | "provider_failure" | "authorization_denied" };

function cancelled(signal?: AbortSignal) { return signal?.aborted === true; }
function abortFailure(): SandboxResult { return { ok: false, failure: { code: "cancelled", message: "Offline voice session cancelled." } }; }

export interface OfflineSttAdapter { transcribe(input: string, signal?: AbortSignal): Promise<{ partial: string; final: string }> }
export interface OfflineLlmAdapter { respond(input: string, signal?: AbortSignal): Promise<string> }
export interface OfflineTtsAdapter { synthesize(input: string, signal?: AbortSignal): Promise<readonly string[]> }

export class DeterministicOfflineStt implements OfflineSttAdapter {
  async transcribe(input: string, signal?: AbortSignal) { if (cancelled(signal)) throw new Error("cancelled"); const text = input.trim(); return { partial: text.slice(0, Math.max(1, Math.ceil(text.length / 2))), final: text }; }
}
export class DeterministicOfflineLlm implements OfflineLlmAdapter {
  async respond(input: string, signal?: AbortSignal) { if (cancelled(signal)) throw new Error("cancelled"); return `Synthetic response to: ${input.trim()}`; }
}
export class DeterministicOfflineTts implements OfflineTtsAdapter {
  async synthesize(input: string, signal?: AbortSignal) { if (cancelled(signal)) throw new Error("cancelled"); return input ? [`synthetic-audio:${input.slice(0, 32)}`] : []; }
}

export class OfflineVoiceSandboxSession {
  readonly events: SandboxEvent[] = [];
  readonly lifecycle: OfflineCallLifecycle;
  private sequence = 0;
  private cancelled = false;
  private record?: CallRecord;
  constructor(readonly organizationId: string, readonly agentId: string, private readonly authorize: (organizationId: string, agentId: string) => boolean, private readonly emergencyStop: () => boolean = () => false, private readonly config: OfflineSandboxConfig = defaultOfflineSandboxConfig, private readonly stt: OfflineSttAdapter = new DeterministicOfflineStt(), private readonly llm: OfflineLlmAdapter = new DeterministicOfflineLlm(), private readonly tts: OfflineTtsAdapter = new DeterministicOfflineTts()) {
    if (!offlineSandboxConfigSchema.safeParse(config).success) throw new Error("Offline sandbox configuration is invalid.");
    this.lifecycle = new OfflineCallLifecycle(authorize, () => emergencyStop());
  }
  private emit(event: SandboxEventInput) { const next = { ...event, sequence: ++this.sequence } as SandboxEvent; this.events.push(next); return next; }
  start(callId: string, timestamp = 0): { ok: true; record: CallRecord } | { ok: false; error: string } {
    if (this.emergencyStop()) return { ok: false, error: "Emergency stop is active." };
    const created = this.lifecycle.create({ callId, organizationId: this.organizationId, agentId: this.agentId, timestamp });
    if (!created.ok) return { ok: false, error: created.error };
    const prepared = this.lifecycle.simulate(callId, ["queued", "preflight_succeeded", "authorized", "connecting", "ringing", "answered", "active"], timestamp + 1);
    if (!prepared.ok) return { ok: false, error: prepared.error };
    this.record = prepared.record; return { ok: true, record: prepared.record };
  }
  async runTurn(input: string, signal?: AbortSignal): Promise<SandboxResult> {
    if (!this.record || this.record.status !== "ACTIVE") return { ok: false, failure: { code: "authorization_denied", message: "An authorized active session is required." } };
    if (this.cancelled || cancelled(signal)) return abortFailure();
    if (!input.trim()) return { ok: false, failure: { code: "disabled", message: "Synthetic input is required." } };
    try {
      const stt = await this.stt.transcribe(input, signal); if (cancelled(signal) || this.cancelled) return abortFailure();
      this.emit({ type: "stt.partial", text: stt.partial }); this.emit({ type: "stt.final", text: stt.final });
      this.emit({ type: "llm.started", text: "Synthetic response generation started." }); const response = await this.llm.respond(stt.final, signal); this.emit({ type: "llm.delta", text: response }); this.emit({ type: "llm.completed", text: response });
      const audio = await this.tts.synthesize(response, signal); if (cancelled(signal) || this.cancelled) return abortFailure();
      this.emit({ type: "tts.started", text: "Synthetic speech started; no audio was generated." }); for (const chunk of audio) this.emit({ type: "tts.audio", text: chunk }); this.emit({ type: "tts.completed", text: "Synthetic speech completed; no audio was generated." });
      return { ok: true, events: this.events.slice(), usage: { inputCharacters: stt.final.length, outputCharacters: response.length, syntheticAudioChunks: audio.length } };
    } catch (error) { const reason = error instanceof Error && error.message === "cancelled" ? "cancelled" : "provider_failure"; this.emit({ type: "session.failed", reason }); return { ok: false, failure: { code: reason === "cancelled" ? "cancelled" : "disabled", message: "Offline provider simulation failed safely." } }; }
  }
  cancel() { this.cancelled = true; this.emit({ type: "session.cancelled", reason: "cancelled" }); if (this.record) this.lifecycle.simulate(this.record.callId, ["cancelled"], Date.now()); }
  complete(timestamp = 1000) { if (!this.record) return { ok: false as const, error: "No active session." }; const result = this.lifecycle.simulate(this.record.callId, ["completed"], timestamp); if (result.ok) this.record = result.record; return result; }
}
