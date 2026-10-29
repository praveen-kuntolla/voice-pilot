import { describe, expect, it } from "vitest";
import { LocalConversationController, MAX_SIMULATION_TURNS, getSimulationPreset, isAuthorizedAgentTestPreflight, mockConversation, roomName, runtimeConfigSchema, simulationPresets } from "@/lib/voice-runtime";

const config = { organizationId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222", language: "en-US", instructions: "Be concise", knowledgeSourceIds: [] };

describe("voice runtime contracts", () => {
  it("validates tenant-scoped runtime config", () => { expect(runtimeConfigSchema.safeParse(config).success).toBe(true); expect(runtimeConfigSchema.safeParse({ ...config, organizationId: "other" }).success).toBe(false); });
  it("uses tenant-scoped room names", () => { expect(roomName(config.organizationId, config.agentId, "session")).toContain(config.organizationId); expect(roomName(config.organizationId, config.agentId, "session")).not.toContain("other"); });
  it("provides a complete local mock flow", () => { expect(mockConversation(runtimeConfigSchema.parse(config)).map((x) => x.state)).toEqual(["greeting", "listening", "understanding", "responding", "speaking", "ended"]); });
  it("exposes only deterministic synthetic presets", () => { expect(simulationPresets).toHaveLength(5); expect(getSimulationPreset("new-inquiry")?.turns.length).toBeGreaterThan(0); expect(getSimulationPreset("unknown")).toBeUndefined(); });
  it("rejects denied, malformed, cross-agent and cross-organization preflight snapshots", () => {
    const valid = { allowed: true, agentId: config.agentId, organizationId: config.organizationId };
    expect(isAuthorizedAgentTestPreflight(valid, config.agentId)).toBe(true);
    expect(isAuthorizedAgentTestPreflight(valid, config.agentId, config.organizationId)).toBe(true);
    expect(isAuthorizedAgentTestPreflight({ ...valid, allowed: false }, config.agentId, config.organizationId)).toBe(false);
    expect(isAuthorizedAgentTestPreflight({ ...valid, agentId: "33333333-3333-4333-8333-333333333333" }, config.agentId, config.organizationId)).toBe(false);
    expect(isAuthorizedAgentTestPreflight({ ...valid, organizationId: "44444444-4444-4444-8444-444444444444" }, config.agentId, config.organizationId)).toBe(false);
    expect(isAuthorizedAgentTestPreflight({ ...valid, organizationId: "invalid" }, config.agentId)).toBe(false);
    expect(isAuthorizedAgentTestPreflight(null, config.agentId)).toBe(false);
  });
});

describe("local simulated conversation controller", () => {
  it("emits ordered deterministic multi-turn events", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config)); const first = await controller.runSimulatedTurn("Hello VoicePilot"); const second = await controller.runSimulatedTurn("What happens next?"); expect(first.at(-1)?.state).toBe("idle"); expect(second.at(-1)?.state).toBe("idle"); expect(controller.turnCount).toBe(2); expect(controller.events.filter((event) => event.kind === "final_transcript").map((event) => event.turnId)).toEqual([1, 2]); expect(controller.events.map((event) => event.sequence)).toEqual([...controller.events.map((event) => event.sequence)].sort((a, b) => a - b)); });
  it("emits deterministic partial, final, response and audio-boundary events", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config)); const events = await controller.runSimulatedTurn("Hello VoicePilot"); expect(events.map((event) => event.kind)).toEqual(["state", "state", "partial_transcript", "final_transcript", "response_chunk", "response_chunk", "audio_chunk", "diagnostic"]); expect(events.some((event) => event.kind === "final_transcript" && event.text === "Hello VoicePilot")).toBe(true); expect(controller.state).toBe("idle"); });
  it("contains error and empty-output scenarios and requires reset after failure", async () => { const errorController = new LocalConversationController(runtimeConfigSchema.parse(config)); expect((await errorController.runSimulatedTurn("test", "error")).at(-1)?.state).toBe("failed"); await expect(errorController.runSimulatedTurn("later")).rejects.toThrow("Reset"); const emptyController = new LocalConversationController(runtimeConfigSchema.parse(config)); expect((await emptyController.runSimulatedTurn("test", "empty")).at(-1)?.text).toContain("empty"); });
  it("suppresses stale slow output after interruption and prevents future turns after end", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config)); const active = controller.runSimulatedTurn("slow turn", "slow"); expect(controller.interrupt()).toBe(true); const events = await active; expect(events.some((event) => event.kind === "final_transcript")).toBe(false); controller.end(); await expect(controller.runSimulatedTurn("later")).rejects.toThrow("ended"); });
  it("rejects duplicate active turns and bounds the turn count", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config), 200, 2); const active = controller.runSimulatedTurn("slow turn", "slow"); await expect(controller.runSimulatedTurn("duplicate")).rejects.toThrow("already active"); await active; await controller.runSimulatedTurn("second"); await expect(controller.runSimulatedTurn("third")).rejects.toThrow("Maximum"); });
  it("enforces the same eight-turn limit as the UI even when called directly", async () => {
    const controller = new LocalConversationController(runtimeConfigSchema.parse(config));
    for (let index = 0; index < MAX_SIMULATION_TURNS; index++) await controller.runSimulatedTurn(`mock ${index + 1}`);
    expect(controller.turnCount).toBe(MAX_SIMULATION_TURNS);
    await expect(controller.runSimulatedTurn("ninth")).rejects.toThrow("Maximum");
    expect(controller.turnCount).toBe(MAX_SIMULATION_TURNS);
  });
  it("rejects empty and oversized input", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config)); await expect(controller.runSimulatedTurn("   ")).rejects.toThrow("required"); await expect(controller.runSimulatedTurn("x".repeat(1001))).rejects.toThrow("1000"); });
  it("bounds local transcript memory", async () => { const controller = new LocalConversationController(runtimeConfigSchema.parse(config), 5); await controller.runSimulatedTurn("one"); expect(controller.events).toHaveLength(5); });
});
