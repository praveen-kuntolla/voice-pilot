import { z } from "zod";

export const browserVoiceSessionRequestSchema = z.object({
  agent_id: z.string().uuid(),
  microphone_consent: z.literal(true),
}).strict();

export type BrowserVoiceSessionRequest = z.infer<typeof browserVoiceSessionRequestSchema>;
export type BrowserVoiceSessionStatus = "unavailable" | "authorizing" | "connecting" | "connected" | "ending" | "ended" | "failed";

export type BrowserVoiceLifecycleState = "idle" | "authorizing" | "connecting" | "connected" | "ending" | "ended" | "failed";
export type BrowserVoiceRecoveryState = "idle" | "termination_requested" | "cleanup_failed" | "termination_unconfirmed" | "awaiting_reconciliation" | "confirmed_cleanup" | "released";

export function nextBrowserVoiceLifecycleState(current: BrowserVoiceLifecycleState, next: BrowserVoiceLifecycleState): BrowserVoiceLifecycleState {
  const allowed: Record<BrowserVoiceLifecycleState, BrowserVoiceLifecycleState[]> = {
    idle: ["authorizing", "failed"],
    authorizing: ["connecting", "failed"],
    connecting: ["connected", "ending", "failed"],
    connected: ["ending", "failed"],
    ending: ["ended", "failed"],
    ended: [],
    failed: ["ending", "ended"],
  };
  if (current === next || allowed[current].includes(next)) return next;
  throw new Error(`invalid browser voice lifecycle transition: ${current} -> ${next}`);
}

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
  private cleanupPromise: Promise<boolean> | undefined;
  private recoveryState: BrowserVoiceRecoveryState = "idle";
  constructor(private readonly operations: BrowserVoiceDisconnectOperations) {}

  get state(): BrowserVoiceRecoveryState { return this.recoveryState; }

  async disconnect(context: BrowserVoiceSessionContext): Promise<boolean> {
    if (this.cleanupPromise) return false;
    this.recoveryState = "termination_requested";
    this.cleanupPromise = (async () => {
      let succeeded = true;
      for (const operation of [
        this.operations.cancelWorker,
        this.operations.removeParticipant,
        this.operations.closeRoom,
        this.operations.revokeAdmission,
      ]) {
        try { await operation(context); } catch { succeeded = false; }
      }
      if (!succeeded) {
        this.recoveryState = "cleanup_failed";
        this.recoveryState = "termination_unconfirmed";
        return false;
      }
      this.recoveryState = "confirmed_cleanup";
      // Capacity release is deliberately fail-closed: an uncertain room or
      // worker termination must be reconciled by an authoritative controller.
      if (succeeded) {
        for (const operation of [this.operations.reconcileUsage, this.operations.releaseReservations]) {
          try { await operation(context); } catch { succeeded = false; }
        }
      }
      if (!succeeded) {
        this.recoveryState = "awaiting_reconciliation";
        return false;
      }
      this.recoveryState = "released";
      return succeeded;
    })();
    return this.cleanupPromise;
  }
}
