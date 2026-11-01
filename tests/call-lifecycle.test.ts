import { describe, expect, it } from "vitest";
import { OfflineCallLifecycle, standardOfflineLifecycle } from "@/lib/call-lifecycle";

const base = { callId: "call-a", organizationId: "org-a", agentId: "agent-a", timestamp: 100 };
const runner = () => new OfflineCallLifecycle((org, agent) => org === "org-a" && agent === "agent-a");

describe("provider-neutral offline call lifecycle", () => {
  it("runs a deterministic authorized call to completion with usage", () => {
    const machine = runner(); expect(machine.create(base).ok).toBe(true);
    const result = machine.simulate(base.callId, standardOfflineLifecycle, 101);
    expect(result).toMatchObject({ ok: true, record: { status: "COMPLETED", simulationOnly: true, usage: { durationSeconds: 42, usageUnits: 42 } } });
  });
  it("rejects invalid transitions, stale events and terminal changes", () => {
    const machine = runner(); machine.create(base);
    expect(machine.apply({ ...base, eventId: "bad", type: "active", timestamp: 101, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "invalid_transition" });
    machine.simulate(base.callId, ["queued"], 101);
    expect(machine.apply({ ...base, eventId: "stale", type: "preflight_succeeded", timestamp: 100, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "stale_event" });
    machine.simulate(base.callId, ["preflight_succeeded", "authorized", "connecting", "answered", "active", "completed"], 102);
    expect(machine.apply({ ...base, eventId: "late", type: "failed", timestamp: 999, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "terminal_state" });
  });
  it("accepts an identical duplicate and rejects conflicting reuse", () => {
    const machine = runner(); machine.create(base); const event = { ...base, eventId: "queued-1", type: "queued" as const, timestamp: 101, metadata: { simulationOnly: true as const } };
    expect(machine.apply(event)).toMatchObject({ ok: true }); expect(machine.apply(event)).toMatchObject({ ok: true, duplicate: true });
    expect(machine.apply({ ...event, timestamp: 102 })).toMatchObject({ ok: false, error: "duplicate_conflict" });
  });
  it("fails closed for cross-tenant, malformed, unauthorized and stopped events", () => {
    const machine = new OfflineCallLifecycle(); machine.create(base);
    expect(machine.apply({ ...base, organizationId: "org-b", eventId: "cross", type: "queued", timestamp: 101, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "tenant_mismatch" });
    let allowed = true; const unauthorized = new OfflineCallLifecycle(() => allowed); unauthorized.create(base); allowed = false; expect(unauthorized.apply({ ...base, eventId: "unauthorized", type: "queued", timestamp: 101, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "unauthorized" });
    const stopped = new OfflineCallLifecycle(undefined, org => org === "org-a"); expect(stopped.create(base)).toMatchObject({ ok: false, error: "emergency_stop" });
    expect(machine.apply({ ...base, eventId: "malformed", type: "queued", timestamp: -1, metadata: { simulationOnly: true } })).toMatchObject({ ok: false, error: "invalid_event" });
  });
  it("supports cancellation and bounded event history without sensitive metadata", () => {
    const machine = new OfflineCallLifecycle(undefined, undefined, 3); machine.create(base); const result = machine.simulate(base.callId, ["cancelled"], 101);
    expect(result).toMatchObject({ ok: true, record: { status: "CANCELLED" } });
    if (result.ok) expect(JSON.stringify(result.record)).not.toMatch(/phone|email|transcript|secret/i);
  });
});
