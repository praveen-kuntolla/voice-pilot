import { describe, expect, it } from "vitest";
import { authorizeDurableBrowserSession, type DurableBrowserAdmission } from "@/lib/durable-browser-admission";

const request = { organizationId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222", actorId: "33333333-3333-4333-8333-333333333333", sessionId: "44444444-4444-4444-8444-444444444444", assertionId: "55555555-5555-4555-8555-555555555555", room: "voicepilot:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444", participantIdentity: "33333333-3333-4333-8333-333333333333" };
const admission: DurableBrowserAdmission = { ...request, reservationId: "reservation-1", reservationState: "active", expiresAt: 2_000 };

describe("durable browser admission foundation", () => {
  it("fails closed without an approved durable gateway", async () => {
    await expect(authorizeDurableBrowserSession(undefined, request, 1_000)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
  });
  it("rejects tenant, agent, session, reservation and expiry mismatches", async () => {
    const gateway = { authorize: async () => admission };
    await expect(authorizeDurableBrowserSession(gateway, { ...request, agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, 1_000)).resolves.toMatchObject({ ok: false, reason: "tenant_mismatch" });
    await expect(authorizeDurableBrowserSession({ authorize: async () => ({ ...admission, reservationState: "active", organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) }, request, 1_000)).resolves.toMatchObject({ ok: false, reason: "tenant_mismatch" });
    await expect(authorizeDurableBrowserSession({ authorize: async () => ({ ...admission, reservationState: "active", expiresAt: 1_000 }) }, request, 1_000)).resolves.toMatchObject({ ok: false, reason: "expired" });
    await expect(authorizeDurableBrowserSession({ authorize: async () => ({ ...admission, reservationState: "active", reservationId: "" }) }, request, 1_000)).resolves.toMatchObject({ ok: false, reason: "reservation_unavailable" });
  });
  it("accepts only the exact active durable record", async () => {
    await expect(authorizeDurableBrowserSession({ authorize: async () => admission }, request, 1_000)).resolves.toEqual({ ok: true, admission });
  });
  it("does not issue admission when the gateway throws or duplicates are not authoritative", async () => {
    await expect(authorizeDurableBrowserSession({ authorize: async () => { throw new Error("database unavailable"); } }, request)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
  });
});
