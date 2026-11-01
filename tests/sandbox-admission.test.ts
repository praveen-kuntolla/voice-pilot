import { describe, expect, it } from "vitest";
import { evaluateSandboxAdmission } from "@/lib/sandbox-admission";

const claims = { organizationId: "org-a", agentId: "agent-a", actorId: "user-a", sessionId: "11111111-1111-4111-8111-111111111111", issuedAt: 1000, expiresAt: 2000, capability: "voice_sandbox", maxDurationSeconds: 60, maxConcurrentSessions: 1, usageLimit: { inputCharacters: 100, outputCharacters: 100 }, providerActivationEnabled: false, emergencyStop: false };
const request = { claims, organizationId: "org-a", agentId: "agent-a", actorId: "user-a" };
const deps = { now: 1500, emergencyStop: false, providerActivationEnabled: false };

describe("offline server/worker sandbox admission", () => {
  it("accepts a tenant-bound synthetic admission without issuing a token", () => expect(evaluateSandboxAdmission(request, deps)).toMatchObject({ ok: true }));
  it("rejects missing, malformed, expired and tenant-mismatched admission", () => { expect(evaluateSandboxAdmission(null, deps)).toEqual({ ok: false, error: "invalid_claims" }); expect(evaluateSandboxAdmission({ ...request, organizationId: "org-b" }, deps)).toEqual({ ok: false, error: "tenant_mismatch" }); expect(evaluateSandboxAdmission(request, { ...deps, now: 2000 })).toEqual({ ok: false, error: "expired" }); });
  it("fails closed for replay, revocation, emergency stop and concurrency", () => { expect(evaluateSandboxAdmission(request, { ...deps, replayed: true })).toEqual({ ok: false, error: "replayed" }); expect(evaluateSandboxAdmission(request, { ...deps, revoked: true })).toEqual({ ok: false, error: "revoked" }); expect(evaluateSandboxAdmission(request, { ...deps, emergencyStop: true })).toEqual({ ok: false, error: "emergency_stop" }); expect(evaluateSandboxAdmission(request, { ...deps, concurrencyAvailable: false })).toEqual({ ok: false, error: "concurrency_exceeded" }); });
  it("never permits provider activation through synthetic claims", () => expect(evaluateSandboxAdmission({ ...request, claims: { ...claims, providerActivationEnabled: true } }, deps)).toEqual({ ok: false, error: "invalid_claims" }));
});
