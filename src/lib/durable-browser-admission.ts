import { z } from "zod";

const uuid = z.string().uuid();

export const durableBrowserAdmissionSchema = z.object({
  organizationId: uuid,
  agentId: uuid,
  actorId: uuid,
  sessionId: uuid,
  assertionId: uuid,
  room: z.string().regex(/^voicepilot:[0-9a-f-]{36}:[0-9a-f-]{36}:[0-9a-f-]{36}$/i),
  participantIdentity: z.string().min(1).max(200),
  reservationId: z.string().min(1).max(200),
  reservationState: z.literal("active"),
  expiresAt: z.number().int().positive(),
}).strict();

export type DurableBrowserAdmission = z.infer<typeof durableBrowserAdmissionSchema>;
export type DurableBrowserAdmissionRequest = Pick<DurableBrowserAdmission, "organizationId" | "agentId" | "actorId" | "sessionId" | "assertionId" | "room" | "participantIdentity">;

export interface DurableBrowserAdmissionGateway {
  authorize(request: DurableBrowserAdmissionRequest): Promise<DurableBrowserAdmission | null>;
}

export type DurableAdmissionResult =
  | { ok: true; admission: DurableBrowserAdmission }
  | { ok: false; reason: "gateway_unavailable" | "invalid_request" | "tenant_mismatch" | "reservation_unavailable" | "expired" };

/**
 * Durable admission is intentionally not constructible from environment flags.
 * A reviewed server gateway must be injected and return the authoritative row.
 */
export async function authorizeDurableBrowserSession(
  gateway: DurableBrowserAdmissionGateway | null | undefined,
  request: unknown,
  now = Date.now(),
): Promise<DurableAdmissionResult> {
  if (!gateway) return { ok: false, reason: "gateway_unavailable" };
  const parsed = durableBrowserAdmissionSchema.pick({
    organizationId: true, agentId: true, actorId: true, sessionId: true,
    assertionId: true, room: true, participantIdentity: true,
  }).safeParse(request);
  if (!parsed.success) return { ok: false, reason: "invalid_request" };
  let admission: DurableBrowserAdmission | null;
  try { admission = await gateway.authorize(parsed.data); } catch { return { ok: false, reason: "gateway_unavailable" }; }
  if (!admission) return { ok: false, reason: "gateway_unavailable" };
  if (admission.organizationId !== parsed.data.organizationId || admission.agentId !== parsed.data.agentId || admission.actorId !== parsed.data.actorId || admission.sessionId !== parsed.data.sessionId || admission.assertionId !== parsed.data.assertionId || admission.room !== parsed.data.room || admission.participantIdentity !== parsed.data.participantIdentity) return { ok: false, reason: "tenant_mismatch" };
  if (admission.reservationState !== "active" || !admission.reservationId) return { ok: false, reason: "reservation_unavailable" };
  if (admission.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, admission };
}

/** Returns false until a reviewed durable gateway is wired into the token route. */
export function isDurableBrowserAdmissionWired(): false { return false; }
