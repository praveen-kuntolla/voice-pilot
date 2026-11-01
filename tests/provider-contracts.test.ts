import { describe, expect, it } from "vitest";
import { offlineProviderSet, validateOfflineVoiceSessionRequest } from "@/lib/provider-contracts";

const request = { sessionId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", agentId: "33333333-3333-4333-8333-333333333333", actorId: "44444444-4444-4444-8444-444444444444", microphoneConsent: true, providerActivationEnabled: false as const, maxDurationSeconds: 60, noRecording: true as const };

describe("offline voice provider contracts", () => {
  it("requires explicit consent and keeps activation disabled", () => {
    expect(validateOfflineVoiceSessionRequest({ ...request, microphoneConsent: false })).toBeNull();
    expect(validateOfflineVoiceSessionRequest({ ...request, providerActivationEnabled: true })).toBeNull();
    expect(validateOfflineVoiceSessionRequest(request)).toEqual(request);
  });
  it("keeps all provider adapters deterministic and offline", async () => {
    const providers = offlineProviderSet();
    for (const provider of Object.values(providers)) {
      const result = await provider.run({ sessionId: request.sessionId, organizationId: request.organizationId, agentId: request.agentId }, "hello");
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    }
  });
});
