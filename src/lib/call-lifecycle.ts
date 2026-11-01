import { z } from "zod";

export const callStates = ["CREATED", "QUEUED", "PREFLIGHT", "AUTHORIZED", "CONNECTING", "RINGING", "ANSWERED", "ACTIVE", "COMPLETED", "FAILED", "CANCELLED", "REJECTED"] as const;
export type CallState = typeof callStates[number];

export const callEventTypes = ["created", "queued", "preflight_succeeded", "authorized", "connecting", "ringing", "answered", "active", "completed", "failed", "cancelled", "rejected"] as const;
export type CallEventType = typeof callEventTypes[number];
export type FailureCategory = "authorization" | "provider" | "timeout" | "policy" | "cancelled" | "unknown";

const id = z.string().trim().min(1).max(160);
export const callEventSchema = z.object({
  callId: id,
  organizationId: id,
  agentId: id,
  campaignId: id.optional(),
  providerReference: id.optional(),
  eventId: id,
  type: z.enum(callEventTypes),
  timestamp: z.number().int().nonnegative().safe(),
  failureCategory: z.enum(["authorization", "provider", "timeout", "policy", "cancelled", "unknown"]).optional(),
  metadata: z.object({
    simulationOnly: z.literal(true),
    durationSeconds: z.number().int().nonnegative().safe().optional(),
    usageUnits: z.number().int().nonnegative().safe().optional(),
    redactedReason: z.string().max(240).optional(),
  }).strict().default({ simulationOnly: true }),
}).strict();
export type CallEvent = z.infer<typeof callEventSchema>;

export type CallUsage = { durationSeconds: number; usageUnits: number };
export type CallRecord = { callId: string; organizationId: string; agentId: string; campaignId?: string; status: CallState; events: CallEvent[]; usage?: CallUsage; simulationOnly: true };

const transitions: Record<CallState, readonly CallState[]> = {
  CREATED: ["QUEUED", "PREFLIGHT", "REJECTED", "CANCELLED"],
  QUEUED: ["PREFLIGHT", "CANCELLED", "REJECTED"],
  PREFLIGHT: ["AUTHORIZED", "REJECTED", "CANCELLED"],
  AUTHORIZED: ["CONNECTING", "REJECTED", "CANCELLED"],
  CONNECTING: ["RINGING", "ANSWERED", "FAILED", "CANCELLED"],
  RINGING: ["ANSWERED", "FAILED", "CANCELLED"],
  ANSWERED: ["ACTIVE", "FAILED", "CANCELLED"],
  ACTIVE: ["COMPLETED", "FAILED", "CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [], REJECTED: [],
};

const eventState: Record<CallEventType, CallState> = {
  created: "CREATED", queued: "QUEUED", preflight_succeeded: "PREFLIGHT", authorized: "AUTHORIZED", connecting: "CONNECTING", ringing: "RINGING", answered: "ANSWERED", active: "ACTIVE", completed: "COMPLETED", failed: "FAILED", cancelled: "CANCELLED", rejected: "REJECTED",
};

export type LifecycleError = "invalid_event" | "tenant_mismatch" | "duplicate_conflict" | "stale_event" | "invalid_transition" | "terminal_state" | "unauthorized" | "emergency_stop";
export type LifecycleResult = { ok: true; record: CallRecord; duplicate?: boolean } | { ok: false; error: LifecycleError };

function safeRecord(record: CallRecord): CallRecord { return { ...record, events: record.events.slice() }; }

export class OfflineCallLifecycle {
  private readonly records = new Map<string, CallRecord>();
  private readonly eventFingerprints = new Map<string, string>();
  constructor(private readonly authorize: (organizationId: string, agentId: string) => boolean = () => true, private readonly stopped: (organizationId: string) => boolean = () => false, private readonly maxEvents = 100) {}

  create(input: { callId: string; organizationId: string; agentId: string; campaignId?: string; timestamp: number }): LifecycleResult {
    const event: CallEvent = { ...input, eventId: `${input.callId}:created`, type: "created", metadata: { simulationOnly: true } };
    const parsed = callEventSchema.safeParse(event);
    if (!parsed.success || this.records.has(input.callId)) return { ok: false, error: "invalid_event" };
    if (this.stopped(input.organizationId) || !this.authorize(input.organizationId, input.agentId)) return { ok: false, error: this.stopped(input.organizationId) ? "emergency_stop" : "unauthorized" };
    const record: CallRecord = { callId: input.callId, organizationId: input.organizationId, agentId: input.agentId, ...(input.campaignId ? { campaignId: input.campaignId } : {}), status: "CREATED", events: [parsed.data], simulationOnly: true };
    this.records.set(input.callId, record); this.eventFingerprints.set(parsed.data.eventId, JSON.stringify(parsed.data));
    return { ok: true, record: safeRecord(record) };
  }

  apply(input: unknown): LifecycleResult {
    const parsed = callEventSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "invalid_event" };
    const event = parsed.data;
    if (this.stopped(event.organizationId)) return { ok: false, error: "emergency_stop" };
    const fingerprint = JSON.stringify(event);
    const previousFingerprint = this.eventFingerprints.get(event.eventId);
    if (previousFingerprint) return previousFingerprint === fingerprint ? { ok: true, record: safeRecord(this.records.get(event.callId)!), duplicate: true } : { ok: false, error: "duplicate_conflict" };
    const record = this.records.get(event.callId);
    if (!record) return { ok: false, error: "invalid_event" };
    if (record.organizationId !== event.organizationId || record.agentId !== event.agentId) return { ok: false, error: "tenant_mismatch" };
    if (!this.authorize(event.organizationId, event.agentId)) return { ok: false, error: "unauthorized" };
    if (event.timestamp < (record.events.at(-1)?.timestamp ?? 0)) return { ok: false, error: "stale_event" };
    const next = eventState[event.type];
    if (record.status === next) return { ok: false, error: "invalid_transition" };
    if (!transitions[record.status].includes(next)) return { ok: false, error: callStates.includes(record.status) && transitions[record.status].length === 0 ? "terminal_state" : "invalid_transition" };
    record.status = next;
    record.events.push(event);
    if (record.events.length > this.maxEvents) record.events.splice(0, record.events.length - this.maxEvents);
    if (next === "COMPLETED") record.usage = { durationSeconds: event.metadata.durationSeconds ?? 0, usageUnits: event.metadata.usageUnits ?? event.metadata.durationSeconds ?? 0 };
    this.eventFingerprints.set(event.eventId, fingerprint);
    return { ok: true, record: safeRecord(record) };
  }

  get(callId: string) { const record = this.records.get(callId); return record ? safeRecord(record) : undefined; }
  simulate(callId: string, types: readonly CallEventType[], startTimestamp: number): LifecycleResult {
    let result = this.get(callId); if (!result) return { ok: false, error: "invalid_event" };
    for (const [index, type] of types.entries()) { const next = this.apply({ callId, organizationId: result.organizationId, agentId: result.agentId, eventId: `${callId}:${type}`, type, timestamp: startTimestamp + index, metadata: { simulationOnly: true, ...(type === "completed" ? { durationSeconds: 42, usageUnits: 42 } : {}) } }); if (!next.ok) return next; result = next.record; }
    return { ok: true, record: result };
  }
}

export const standardOfflineLifecycle = ["queued", "preflight_succeeded", "authorized", "connecting", "ringing", "answered", "active", "completed"] as const;
