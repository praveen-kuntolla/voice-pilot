import { z } from "zod";

export const browserVoiceSessionRequestSchema = z.object({
  agent_id: z.string().uuid(),
  microphone_consent: z.literal(true),
}).strict();

export type BrowserVoiceSessionRequest = z.infer<typeof browserVoiceSessionRequestSchema>;
export type BrowserVoiceSessionStatus = "unavailable" | "authorizing" | "connecting" | "connected" | "ending" | "ended" | "failed";

/**
 * Explicit future activation envelope. All values are server-side; the browser
 * cannot opt itself into a live session. The default is always disabled.
 */
export function isBrowserVoiceActivationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.VOICE_BROWSER_VOICE_SESSION_ENABLED === "true"
    && env.VOICE_PROVIDER_ACTIVATION_ENABLED === "true"
    && env.VOICE_REALTIME_ENABLED === "true"
    && env.VOICE_OUTBOUND_ENABLED !== "true"
    && env.VOICE_RECORDING_ENABLED !== "true";
}

export type BrowserVoiceSessionContext = {
  sessionId: string;
  organizationId: string;
  agentId: string;
  actorId: string;
};

export type BrowserVoiceDisconnectOperations = {
  cancelWorker: (context: BrowserVoiceSessionContext) => Promise<void>;
  removeParticipant: (context: BrowserVoiceSessionContext) => Promise<void>;
  closeRoom: (context: BrowserVoiceSessionContext) => Promise<void>;
  revokeAdmission: (context: BrowserVoiceSessionContext) => Promise<void>;
  reconcileUsage: (context: BrowserVoiceSessionContext) => Promise<void>;
  releaseReservations: (context: BrowserVoiceSessionContext) => Promise<void>;
};

/** Ordered, idempotent orchestration boundary for future provider disconnects. */
export class BrowserVoiceDisconnectController {
  private disconnected = false;
  constructor(private readonly operations: BrowserVoiceDisconnectOperations) {}

  async disconnect(context: BrowserVoiceSessionContext): Promise<boolean> {
    if (this.disconnected) return false;
    this.disconnected = true;
    await this.operations.cancelWorker(context);
    await this.operations.removeParticipant(context);
    await this.operations.closeRoom(context);
    await this.operations.revokeAdmission(context);
    await this.operations.reconcileUsage(context);
    await this.operations.releaseReservations(context);
    return true;
  }
}
