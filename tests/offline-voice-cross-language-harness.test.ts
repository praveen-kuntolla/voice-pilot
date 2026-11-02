import { describe, expect, it } from "vitest";
import exchange from "../contracts/offline-voice-pipeline-v1.exchange.json";
import { OfflineVoiceEventLedger, validateOfflineVoiceSessionRequest } from "@/lib/offline-voice-pipeline-contract";

describe("offline cross-language voice contract exchange", () => {
  it("accepts TypeScript- and Python-produced synthetic lifecycles", () => {
    const request = validateOfflineVoiceSessionRequest(exchange.session_request)!;
    for (const produced of [exchange.typescript_produced_events, exchange.python_produced_events]) {
      const ledger = new OfflineVoiceEventLedger(request);
      for (const event of produced) expect(ledger.append(event)).toEqual({ ok: true });
      expect(ledger.currentState).toBe("ended");
      expect(ledger.lastSequence).toBe(produced.length);
    }
  });

  it("rejects stale, replayed, cross-tenant, malformed, and transcript-bearing payloads", () => {
    const request = validateOfflineVoiceSessionRequest(exchange.session_request)!;
    const ledger = new OfflineVoiceEventLedger(request);
    const first = exchange.typescript_produced_events[0];
    expect(ledger.append(first)).toEqual({ ok: true });
    expect(ledger.append(first)).toEqual({ ok: true, duplicate: true });
    expect(ledger.append({ ...exchange.typescript_produced_events[1], sequence: 1 })).toMatchObject({ ok: false, error: "stale_event" });
    expect(ledger.append({ ...exchange.typescript_produced_events[1], event_id: "cross-tenant", sequence: 2, organization_id: "other-org" })).toMatchObject({ ok: false, error: "unauthorized" });
    expect(ledger.append({ ...exchange.typescript_produced_events[1], event_id: "raw-text", sequence: 2, metadata: { simulation_only: true, text: "secret" } })).toMatchObject({ ok: false, error: "unauthorized" });
  });
});
