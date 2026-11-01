import { describe, expect, it } from "vitest";
import { defaultOfflineSandboxConfig, DeterministicOfflineLlm, OfflineVoiceSandboxSession, offlineSandboxConfigSchema } from "@/lib/voice-sandbox";

const session = (allowed = true, stopped = false) => new OfflineVoiceSandboxSession("org-a", "agent-a", () => allowed, () => stopped);

describe("offline voice sandbox", () => {
  it("runs deterministic STT, LLM and TTS events without audio or network", async () => {
    const current = session(); expect(current.start("call-a", 1).ok).toBe(true);
    const result = await current.runTurn("Hello synthetic customer");
    expect(result).toMatchObject({ ok: true, usage: { syntheticAudioChunks: 1 } });
    expect(current.events.map(event => event.type)).toEqual(["stt.partial", "stt.final", "llm.started", "llm.delta", "llm.completed", "tts.started", "tts.audio", "tts.completed"]);
    expect(JSON.stringify(current.events)).not.toMatch(/phone|email|secret|http/i);
  });
  it("fails closed for authorization, emergency stop and invalid configuration", () => {
    expect(session(false).start("call-denied")).toMatchObject({ ok: false, error: "unauthorized" });
    expect(session(true, true).start("call-stopped")).toMatchObject({ ok: false, error: "Emergency stop is active." });
    expect(offlineSandboxConfigSchema.safeParse({ ...defaultOfflineSandboxConfig, microphoneEnabled: true }).success).toBe(false);
  });
  it("cancels pending work and prevents a later turn", async () => {
    const current = session(); current.start("call-cancel"); const controller = new AbortController(); controller.abort();
    const aborted = await current.runTurn("cancel me", controller.signal); expect(aborted.ok).toBe(false); if (!aborted.ok) expect(aborted.failure.code).toBe("cancelled"); current.cancel(); const after = await current.runTurn("again"); expect(after.ok).toBe(false); if (!after.ok) expect(after.failure.code).toBe("cancelled");
  });
  it("maps adapter failure to a sanitized offline failure", async () => {
    const failing = new OfflineVoiceSandboxSession("org-a", "agent-a", () => true, () => false, defaultOfflineSandboxConfig, undefined, new DeterministicOfflineLlm(), { synthesize: async () => { throw new Error("provider-secret"); } }); failing.start("call-fail");
    const result = await failing.runTurn("hello"); expect(result).toMatchObject({ ok: false, failure: { code: "disabled", message: "Offline provider simulation failed safely." } }); expect(JSON.stringify(result)).not.toContain("provider-secret");
  });
  it("completes through the Phase 9 lifecycle with deterministic usage", async () => { const current = session(); current.start("call-complete", 1); await current.runTurn("finish"); const result = current.complete(10); expect(result).toMatchObject({ ok: true, record: { status: "COMPLETED", simulationOnly: true } }); });
});
