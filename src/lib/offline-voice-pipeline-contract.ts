import { z } from "zod";

export const OFFLINE_VOICE_PIPELINE_CONTRACT_VERSION = "offline.voice.pipeline.v1" as const;
export const MAX_OFFLINE_TURN_CHARS = 1000;

const boundedId = z.string().trim().min(1).max(160);
const metadataSchema = z.object({
  simulation_only: z.literal(true),
  stage: z.enum(["listening", "transcribing", "thinking", "speaking", "interrupted", "ended"]).optional(),
  action: z.enum(["started", "interrupt", "cancel", "emergency_stop", "cleanup"]).optional(),
  text_length: z.number().int().min(0).max(MAX_OFFLINE_TURN_CHARS).optional(),
  text_sha256_prefix: z.string().regex(/^[0-9a-f]{16}$/).optional(),
}).strict();

export const offlineVoiceSessionRequestSchema = z.object({
  contract_version: z.literal(OFFLINE_VOICE_PIPELINE_CONTRACT_VERSION),
  session_id: boundedId,
  organization_id: boundedId,
  agent_id: boundedId,
  actor_id: boundedId,
  expires_at_ms: z.number().int().positive(),
  max_turn_chars: z.number().int().min(1).max(MAX_OFFLINE_TURN_CHARS),
  provider_mode: z.literal("mock"),
  simulation_only: z.literal(true),
  no_recording: z.literal(true),
}).strict();

export const offlineVoiceEventSchema = z.object({
  contract_version: z.literal(OFFLINE_VOICE_PIPELINE_CONTRACT_VERSION),
  event_id: boundedId,
  session_id: boundedId,
  organization_id: boundedId,
  agent_id: boundedId,
  actor_id: boundedId,
  sequence: z.number().int().positive(),
  turn_id: z.number().int().nonnegative(),
  event_type: z.enum(["session_started", "turn_started", "transcript", "response", "speech", "interrupted", "provider_failed", "cancelled", "emergency_stopped", "session_expired", "session_ended", "cleanup_completed"]),
  state: z.enum(["ready", "active", "interrupted", "cancelled", "stopped", "ended", "failed"]),
  metadata: metadataSchema,
}).strict();

export type OfflineVoiceSessionRequest = z.infer<typeof offlineVoiceSessionRequestSchema>;
export type OfflineVoiceEvent = z.infer<typeof offlineVoiceEventSchema>;
export type OfflineVoicePipelineState = OfflineVoiceEvent["state"];
export type OfflineVoiceContractError = "invalid" | "unauthorized" | "stale_event" | "duplicate_conflict" | "invalid_transition" | "provider_disabled";

const transitions: Record<OfflineVoicePipelineState, readonly OfflineVoicePipelineState[]> = {
  ready: ["active", "ended"],
  active: ["active", "interrupted", "cancelled", "stopped", "ended", "failed"],
  interrupted: ["active", "cancelled", "stopped", "ended"],
  cancelled: ["ended"],
  stopped: ["ended"],
  ended: ["ended"],
  failed: ["active", "cancelled", "stopped", "ended"],
};

export type OfflineVoiceContractResult = { ok: true; duplicate?: boolean } | { ok: false; error: OfflineVoiceContractError; message: string };

function fingerprint(event: OfflineVoiceEvent): string { return JSON.stringify(event); }

export function validateOfflineVoiceSessionRequest(input: unknown): OfflineVoiceSessionRequest | null {
  const parsed = offlineVoiceSessionRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function validateOfflineVoiceEvent(input: unknown, request: OfflineVoiceSessionRequest): OfflineVoiceEvent | null {
  const parsed = offlineVoiceEventSchema.safeParse(input);
  if (!parsed.success) return null;
  const event = parsed.data;
  if (event.session_id !== request.session_id || event.organization_id !== request.organization_id || event.agent_id !== request.agent_id || event.actor_id !== request.actor_id) return null;
  return event;
}

/** Process-local contract ledger; distributed replay protection requires a future trusted store. */
export class OfflineVoiceEventLedger {
  private readonly events = new Map<string, string>();
  private highestSequence = 0;
  private state: OfflineVoicePipelineState = "ready";

  constructor(private readonly request: OfflineVoiceSessionRequest) {}

  append(input: unknown): OfflineVoiceContractResult {
    const event = validateOfflineVoiceEvent(input, this.request);
    if (!event) return { ok: false, error: "unauthorized", message: "event identity or shape is invalid" };
    const existing = this.events.get(event.event_id);
    const currentFingerprint = fingerprint(event);
    if (existing) return existing === currentFingerprint ? { ok: true, duplicate: true } : { ok: false, error: "duplicate_conflict", message: "event identifier was reused with different content" };
    if (event.sequence <= this.highestSequence) return { ok: false, error: "stale_event", message: "event sequence is stale or out of order" };
    if (!transitions[this.state].includes(event.state)) return { ok: false, error: "invalid_transition", message: `invalid transition ${this.state} -> ${event.state}` };
    this.events.set(event.event_id, currentFingerprint);
    this.highestSequence = event.sequence;
    this.state = event.state;
    return { ok: true };
  }

  get currentState(): OfflineVoicePipelineState { return this.state; }
  get lastSequence(): number { return this.highestSequence; }
}
