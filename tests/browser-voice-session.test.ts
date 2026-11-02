import { describe, expect, it, vi } from "vitest";
import { BrowserVoiceDisconnectController, isBrowserVoiceActivationEnabled, nextBrowserVoiceLifecycleState } from "@/lib/browser-voice-session";
import { POST } from "@/app/api/livekit/browser-session/route";
import { currentMembership } from "@/lib/authz";

vi.mock("@/lib/authz", () => ({ currentMembership: vi.fn() }));

describe("browser voice activation boundary", () => {
  it("is disabled unless every explicit future gate is enabled", () => {
    expect(isBrowserVoiceActivationEnabled({})).toBe(false);
    expect(isBrowserVoiceActivationEnabled({ VOICE_BROWSER_VOICE_SESSION_ENABLED: "true", VOICE_PROVIDER_ACTIVATION_ENABLED: "true", VOICE_REALTIME_ENABLED: "true", VOICE_OUTBOUND_ENABLED: "true" })).toBe(false);
    expect(isBrowserVoiceActivationEnabled({ VOICE_BROWSER_VOICE_SESSION_ENABLED: "true", VOICE_PROVIDER_ACTIVATION_ENABLED: "true", VOICE_REALTIME_ENABLED: "true", VOICE_OUTBOUND_ENABLED: "false", VOICE_RECORDING_ENABLED: "false" })).toBe(true);
  });

  it("runs emergency disconnect operations once and in safe order", async () => {
    const calls: string[] = [];
    const op = (name: string) => vi.fn(async () => { calls.push(name); });
    const controller = new BrowserVoiceDisconnectController({ cancelWorker: op("cancel-worker"), removeParticipant: op("remove-participant"), closeRoom: op("close-room"), revokeAdmission: op("revoke-admission"), reconcileUsage: op("reconcile-usage"), releaseReservations: op("release-reservations") });
    const context = { sessionId: "session", organizationId: "org", agentId: "agent", actorId: "actor" };
    expect(await controller.disconnect(context)).toBe(true);
    expect(controller.state).toBe("released");
    expect(await controller.disconnect(context)).toBe(false);
    expect(controller.state).toBe("released");
    expect(calls).toEqual(["cancel-worker", "remove-participant", "close-room", "revoke-admission", "reconcile-usage", "release-reservations"]);
  });

  it("continues cleanup after an operation fails and reports failure", async () => {
    const calls: string[] = [];
    const op = (name: string, failure = false) => vi.fn(async () => { calls.push(name); if (failure) throw new Error(name); });
    const controller = new BrowserVoiceDisconnectController({ cancelWorker: op("cancel-worker", true), removeParticipant: op("remove-participant"), closeRoom: op("close-room"), revokeAdmission: op("revoke-admission"), reconcileUsage: op("reconcile-usage"), releaseReservations: op("release-reservations") });
    const context = { sessionId: "session", organizationId: "org", agentId: "agent", actorId: "actor" };
    expect(await controller.disconnect(context)).toBe(false);
    expect(controller.state).toBe("termination_unconfirmed");
    expect(calls).toEqual(["cancel-worker", "remove-participant", "close-room", "revoke-admission"]);
    expect(await controller.disconnect(context)).toBe(false);
  });

  it("does not release capacity when termination is uncertain", async () => {
    const calls: string[] = [];
    const op = (name: string, failure = false) => vi.fn(async () => { calls.push(name); if (failure) throw new Error(name); });
    const controller = new BrowserVoiceDisconnectController({ cancelWorker: op("cancel-worker"), removeParticipant: op("remove-participant"), closeRoom: op("close-room", true), revokeAdmission: op("revoke-admission"), reconcileUsage: op("reconcile-usage"), releaseReservations: op("release-reservations") });
    const context = { sessionId: "session", organizationId: "org", agentId: "agent", actorId: "actor" };
    expect(await controller.disconnect(context)).toBe(false);
    expect(calls).toEqual(["cancel-worker", "remove-participant", "close-room", "revoke-admission"]);
  });

  it("records reconciliation when confirmed cleanup cannot release capacity", async () => {
    const op = (failure = false) => vi.fn(async () => { if (failure) throw new Error("offline failure"); });
    const controller = new BrowserVoiceDisconnectController({ cancelWorker: op(), removeParticipant: op(), closeRoom: op(), revokeAdmission: op(), reconcileUsage: op(true), releaseReservations: op() });
    const context = { sessionId: "session", organizationId: "org", agentId: "agent", actorId: "actor" };
    expect(await controller.disconnect(context)).toBe(false);
    expect(controller.state).toBe("awaiting_reconciliation");
  });

  it("accepts only ordered lifecycle transitions", () => {
    expect(nextBrowserVoiceLifecycleState("idle", "authorizing")).toBe("authorizing");
    expect(nextBrowserVoiceLifecycleState("failed", "ending")).toBe("ending");
    expect(() => nextBrowserVoiceLifecycleState("ended", "connected")).toThrow("invalid browser voice lifecycle transition");
  });

  it("rejects unauthenticated and disabled browser admission before token issuance", async () => {
    const request = new Request("http://localhost/api/livekit/browser-session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agent_id: "22222222-2222-4222-8222-222222222222", microphone_consent: true }) });
    vi.mocked(currentMembership).mockResolvedValue({ user: null, membership: null } as never);
    expect((await POST(request)).status).toBe(401);
    vi.mocked(currentMembership).mockResolvedValue({ user: { id: "actor" }, membership: { organization_id: "11111111-1111-4111-8111-111111111111" } } as never);
    expect((await POST(request)).status).toBe(503);
  });
});
