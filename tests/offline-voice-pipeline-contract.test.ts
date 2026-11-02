import { describe, expect, it } from "vitest";
import fixture from "../contracts/offline-voice-pipeline-v1.fixture.json";
import {
  OfflineVoiceEventLedger,
  offlineVoiceEventSchema,
  offlineVoiceSessionRequestSchema,
  validateOfflineVoiceEvent,
  validateOfflineVoiceSessionRequest,
} from "@/lib/offline-voice-pipeline-contract";

describe("offline voice pipeline v1 contract", () => {
  it("validates the shared TypeScript/Python fixture", () => {
    const request = validateOfflineVoiceSessionRequest(fixture.session_request);
    expect(request).not.toBeNull();
    expect(validateOfflineVoiceEvent(fixture.event, request!)).not.toBeNull();
    expect(offlineVoiceSessionRequestSchema.shape.provider_mode.value).toBe("mock");
  });

  it("enforces monotonic ordering, replay idempotence, and transitions", () => {
    const request = validateOfflineVoiceSessionRequest(fixture.session_request)!;
    const ledger = new OfflineVoiceEventLedger(request);
    expect(ledger.append(fixture.event)).toEqual({ ok: true });
    expect(ledger.append(fixture.event)).toEqual({ ok: true, duplicate: true });
    expect(ledger.append({ ...fixture.event, event_id: "session-a:0", sequence: 0 })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(ledger.append({ ...fixture.event, event_id: "session-a:1-conflict", sequence: 2, state: "ready" })).toMatchObject({ ok: false, error: "invalid_transition" });
    expect(ledger.currentState).toBe("active");
  });

  it("rejects cross-tenant events and raw transcript fields", () => {
    const request = validateOfflineVoiceSessionRequest(fixture.session_request)!;
    expect(validateOfflineVoiceEvent(fixture.event, request)).not.toBeNull();
    expect(validateOfflineVoiceEvent({ ...fixture.event, organization_id: "org-b" }, request)).toBeNull();
    expect(offlineVoiceEventSchema.safeParse({ ...fixture.event, metadata: { simulation_only: true, text: "secret" } }).success).toBe(false);
  });
});
