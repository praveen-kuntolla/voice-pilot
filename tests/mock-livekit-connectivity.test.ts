import { describe, expect, it } from "vitest";
import {
  createMockConnectivityRequest,
  MockLiveKitConnectivityAdapter,
  validateMockTokenScope,
} from "@/lib/mock-livekit-connectivity";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "33333333-3333-4333-8333-333333333333";
const agent = "22222222-2222-4222-8222-222222222222";
const actor = "user-1";
const gate = { featureEnabled: true, approvedForSingleSession: true, providerMode: "mock" as const, outboundEnabled: false };
const request = createMockConnectivityRequest({ sessionId: "44444444-4444-4444-8444-444444444444", organizationId: org, agentId: agent, actorId: actor, issuedAt: 1000 });

describe("offline mock LiveKit connectivity preparation", () => {
  it("is fail-closed when the feature flag is disabled", () => {
    const result = new MockLiveKitConnectivityAdapter({ ...gate, featureEnabled: false }, () => 1000).prepare({ authenticated: true, actorId: actor, organizationId: org }, request);
    expect(result).toEqual({ ok: false, state: "disabled", failure: "disabled" });
  });

  it("rejects anonymous and cross-tenant identities", () => {
    const adapter = new MockLiveKitConnectivityAdapter(gate, () => 1000);
    expect(adapter.prepare({ authenticated: false }, request)).toMatchObject({ ok: false, failure: "anonymous" });
    expect(adapter.prepare({ authenticated: true, actorId: actor, organizationId: otherOrg }, request)).toMatchObject({ ok: false, failure: "unauthorized" });
  });

  it("validates room scope and expiration without issuing a token", () => {
    expect(validateMockTokenScope(request, request, 1000)).toEqual({ ok: true });
    expect(validateMockTokenScope({ ...request, room: request.room.replace(org, otherOrg) }, request, 1000)).toEqual({ ok: false, reason: "invalid_scope" });
    expect(validateMockTokenScope(request, request, request.expiresAt)).toEqual({ ok: false, reason: "expired" });
  });

  it("runs a deterministic mock lifecycle and cleanup", () => {
    const adapter = new MockLiveKitConnectivityAdapter(gate, () => 1000);
    expect(adapter.prepare({ authenticated: true, actorId: actor, organizationId: org }, request)).toMatchObject({ ok: true, state: "ready_for_approved_test" });
    expect(adapter.connect(request.sessionId)).toMatchObject({ state: "connected_mock" });
    expect(adapter.disconnect(request.sessionId)).toMatchObject({ state: "disconnected", cleanupCompleted: true });
    expect(adapter.cleanup(request.sessionId)).toBe(true);
    expect(adapter.cleanup(request.sessionId)).toBe(false);
  });

  it("enforces one active synthetic session", () => {
    const adapter = new MockLiveKitConnectivityAdapter(gate, () => 1000);
    const first = request;
    const second = createMockConnectivityRequest({ sessionId: "55555555-5555-4555-8555-555555555555", organizationId: org, agentId: agent, actorId: actor, issuedAt: 1000 });
    expect(adapter.prepare({ authenticated: true, actorId: actor, organizationId: org }, first)).toMatchObject({ ok: true });
    expect(adapter.prepare({ authenticated: true, actorId: actor, organizationId: org }, second)).toMatchObject({ ok: false, failure: "session_limit" });
  });

  it("stops and cleans every session deterministically", () => {
    const adapter = new MockLiveKitConnectivityAdapter(gate, () => 1000);
    adapter.prepare({ authenticated: true, actorId: actor, organizationId: org }, request);
    expect(adapter.emergencyStop()).toMatchObject([{ state: "disconnected", emergencyStopped: true, cleanupCompleted: true }]);
    expect(adapter.connect(request.sessionId)).toMatchObject({ state: "failed", failure: "emergency_stopped" });
  });
});
