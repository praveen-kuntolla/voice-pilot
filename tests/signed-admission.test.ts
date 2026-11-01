import { describe, expect, it } from "vitest";
import { canonicalAdmission, MemoryAdmissionState, signAdmission, verifySignedAdmission, type SignedAdmissionClaims } from "@/lib/signed-admission";

const claims: SignedAdmissionClaims = { version: 1, keyId: "test-key-1", assertionId: "22222222-2222-4222-8222-222222222222", organizationId: "org-a", agentId: "agent-a", actorId: "user-a", sessionId: "11111111-1111-4111-8111-111111111111", issuedAt: 1000, expiresAt: 2000, capability: "voice_sandbox", maxDurationSeconds: 60, usageLimit: { inputCharacters: 100, outputCharacters: 200 }, providerActivationEnabled: false };
const secret = "offline-test-signing-key"; const context = { organizationId: "org-a", agentId: "agent-a", actorId: "user-a" };
const signed = () => ({ claims, signature: signAdmission(claims, secret) });

describe("signed offline worker admission", () => {
  it("verifies a canonical TypeScript assertion", () => expect(verifySignedAdmission(signed(), key => key === "test-key-1" ? secret : undefined, 1500, context)).toBe(true));
  it("rejects tampering, unknown keys, malformed signatures, expiry and tenant mismatch", () => { const value = signed(); expect(verifySignedAdmission({ ...value, claims: { ...claims, agentId: "agent-b" } }, () => secret, 1500, context)).toBe(false); expect(verifySignedAdmission(value, () => undefined, 1500, context)).toBe(false); expect(verifySignedAdmission({ ...value, signature: "00" }, () => secret, 1500, context)).toBe(false); expect(verifySignedAdmission(value, () => secret, 2000, context)).toBe(false); expect(verifySignedAdmission(value, () => secret, 1500, { ...context, organizationId: "org-b" })).toBe(false); });
  it("fails closed for replay, revocation, emergency stop and concurrency", () => { const value = signed(); expect(verifySignedAdmission(value, () => secret, 1500, context, { replayed: true })).toBe(false); expect(verifySignedAdmission(value, () => secret, 1500, context, { revoked: true })).toBe(false); expect(verifySignedAdmission(value, () => secret, 1500, context, { emergencyStop: true })).toBe(false); expect(verifySignedAdmission(value, () => secret, 1500, context, { concurrencyAvailable: false })).toBe(false); });
  it("uses atomic process-local consumption and revocation state", () => { const state = new MemoryAdmissionState(); expect(state.consume(claims.assertionId)).toBe(true); expect(state.consume(claims.assertionId)).toBe(false); state.revoke(claims.assertionId); expect(state.isRevoked(claims.assertionId)).toBe(true); state.clear(claims.assertionId); expect(state.consume(claims.assertionId)).toBe(true); });
  it("uses unambiguous canonical fields", () => expect(canonicalAdmission(claims)).toContain("voicepilot-admission|1|10:test-key-1"));
});
