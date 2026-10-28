import { describe, expect, it } from "vitest";
import { createGatewayEvent, MemoryGatewayEventSink } from "@/lib/gateway-observability";

describe("offline gateway observability", () => {
  it("records bounded structured events without arbitrary sensitive fields", () => {
    const sink = new MemoryGatewayEventSink();
    sink.emit({ type: "authorization_denied", correlationId: "corr-1", organizationId: "org-1", reason: "membership_removed", occurredAt: 10 });
    expect(sink.events).toEqual([{ type: "authorization_denied", correlationId: "corr-1", organizationId: "org-1", reason: "membership_removed", occurredAt: 10 }]);
    expect(sink.events[0]).not.toHaveProperty("token");
    expect(sink.events[0]).not.toHaveProperty("contact");
  });

  it("rejects malformed or log-injection event values", () => {
    expect(createGatewayEvent({ type: "transaction_failed", correlationId: "bad\nentry", reason: "failure", occurredAt: 1 })).toBeNull();
    expect(createGatewayEvent({ type: "transaction_failed", correlationId: "corr", reason: "failure", occurredAt: Number.NaN })).toBeNull();
  });
});
