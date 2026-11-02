import { Room, RoomEvent, type DisconnectReason } from "livekit-client";

export type BrowserVoiceSessionState = "unavailable" | "idle" | "connecting" | "connected" | "reconnecting" | "ended" | "error";
export type BrowserVoiceSessionSnapshot = { state: BrowserVoiceSessionState; participantCount: number; activeSpeakerCount: number; microphoneEnabled: boolean; error?: string; disconnectReason?: DisconnectReason };
export type BrowserRoom = {
  connect: Room["connect"];
  disconnect: Room["disconnect"];
  on: (event: RoomEvent, listener: (...args: never[]) => void) => void;
  off: (event: RoomEvent, listener: (...args: never[]) => void) => void;
  remoteParticipants: Room["remoteParticipants"];
  localParticipant: Pick<Room["localParticipant"], "setMicrophoneEnabled">;
};
export type BrowserRoomFactory = () => BrowserRoom;
export type BrowserVoiceSessionOptions = { enabled?: boolean; roomFactory?: BrowserRoomFactory };
export type BrowserVoiceSessionListener = (snapshot: BrowserVoiceSessionSnapshot) => void;
export type BrowserSessionAuthorization = { url: string; token: string; room: string; sessionId: string };

const defaultRoomFactory: BrowserRoomFactory = () => new Room({ adaptiveStream: true, dynacast: true });

/** SDK-backed orchestration. Construction is side-effect free; connect and microphone capture require explicit enablement and caller action. */
export class LiveKitBrowserVoiceSession {
  readonly room: BrowserRoom;
  private readonly enabled: boolean;
  private readonly listeners = new Set<BrowserVoiceSessionListener>();
  private snapshot: BrowserVoiceSessionSnapshot;
  private readonly handlers: Array<[RoomEvent, (...args: never[]) => void]>;
  private transition: Promise<void> = Promise.resolve();
  private authorization?: BrowserSessionAuthorization;

  constructor(options: BrowserVoiceSessionOptions = {}) {
    this.enabled = options.enabled === true;
    this.room = (options.roomFactory ?? defaultRoomFactory)();
    this.snapshot = this.enabled ? { state: "idle", participantCount: 0, activeSpeakerCount: 0, microphoneEnabled: false } : { state: "unavailable", participantCount: 0, activeSpeakerCount: 0, microphoneEnabled: false, error: "LiveKit activation is disabled" };
    this.handlers = [
      [RoomEvent.Reconnecting, (() => this.update({ state: "reconnecting" })) as (...args: never[]) => void],
      [RoomEvent.Reconnected, (() => this.update({ state: "connected", error: undefined })) as (...args: never[]) => void],
      [RoomEvent.ParticipantConnected, (() => this.refreshParticipants()) as (...args: never[]) => void],
      [RoomEvent.ParticipantDisconnected, (() => this.refreshParticipants()) as (...args: never[]) => void],
      [RoomEvent.ActiveSpeakersChanged, ((speakers: unknown[]) => this.update({ activeSpeakerCount: speakers.length })) as (...args: never[]) => void],
      [RoomEvent.Disconnected, ((reason: DisconnectReason) => this.update({ state: "ended", disconnectReason: reason })) as (...args: never[]) => void],
    ];
    for (const [event, handler] of this.handlers) this.room.on(event, handler);
  }

  getSnapshot(): BrowserVoiceSessionSnapshot { return this.snapshot; }
  subscribe(listener: BrowserVoiceSessionListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  connect(authorization: BrowserSessionAuthorization): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) throw new Error("LiveKit activation is disabled");
      if (!authorization.url || !authorization.token || !authorization.room || !authorization.sessionId) throw new Error("Server-issued browser authorization is incomplete");
      this.authorization = authorization;
      this.update({ state: "connecting", error: undefined });
      try { await this.room.connect(authorization.url, authorization.token, { autoSubscribe: true }); this.refreshParticipants(); this.update({ state: "connected" }); }
      catch (error) { this.authorization = undefined; await this.safeDisconnect(); this.update({ state: "error", microphoneEnabled: false, error: error instanceof Error ? error.message : "LiveKit connection failed" }); throw error; }
    });
  }
  setMicrophoneEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) throw new Error("LiveKit activation is disabled");
      if (this.snapshot.state !== "connected" || !this.authorization) throw new Error("An authorized connected session is required for microphone access");
      await this.room.localParticipant.setMicrophoneEnabled(enabled);
      this.update({ microphoneEnabled: enabled });
    });
  }
  disconnect(): Promise<void> { return this.enqueue(async () => { this.authorization = undefined; await this.safeDisconnect(); this.update({ state: "ended", microphoneEnabled: false }); }); }
  async dispose(): Promise<void> { await this.disconnect(); for (const [event, handler] of this.handlers) this.room.off(event, handler); this.listeners.clear(); }
  private refreshParticipants(): void { this.update({ participantCount: this.room.remoteParticipants.size }); }
  private update(patch: Partial<BrowserVoiceSessionSnapshot>): void { this.snapshot = { ...this.snapshot, ...patch }; for (const listener of this.listeners) listener(this.snapshot); }
  private enqueue(task: () => Promise<void>): Promise<void> { const next = this.transition.then(task, task); this.transition = next.catch(() => undefined); return next; }
  private async safeDisconnect(): Promise<void> { try { await this.room.localParticipant.setMicrophoneEnabled(false); } catch { /* best-effort track cleanup */ } try { await this.room.disconnect(); } catch { /* preserve the original failure */ } }
}

export function createDisabledBrowserVoiceSession(): BrowserVoiceSessionSnapshot { return new LiveKitBrowserVoiceSession().getSnapshot(); }
export function endBrowserVoiceSession(session: BrowserVoiceSessionSnapshot): BrowserVoiceSessionSnapshot { return { ...session, state: "ended", microphoneEnabled: false, error: undefined }; }
