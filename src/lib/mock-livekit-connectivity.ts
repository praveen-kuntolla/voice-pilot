import { z } from "zod";
import { parseVoiceRoomName, voiceRoomName } from "@/lib/livekit";

/** Deliberately offline: this module never imports an SDK or creates a room. */
export const MOCK_CONNECTIVITY_LABEL = "MOCK ONLY — no LiveKit, audio, providers, or customer data";
export const MOCK_CONNECTIVITY_TTL_MS = 5 * 60 * 1000;

export type MockConnectivityState =
  | "disabled"
  | "ready_for_approved_test"
  | "connecting_mock"
  | "connected_mock"
  | "disconnected"
  | "failed";

export type MockConnectivityFailure =
  | "anonymous"
  | "unauthorized"
  | "disabled"
  | "expired"
  | "session_limit"
  | "emergency_stopped"
  | "invalid_scope";

export type MockConnectivityIdentity = {
  authenticated: boolean;
  actorId?: string;
  organizationId?: string;
};

export type MockConnectivityRequest = {
  sessionId: string;
  organizationId: string;
  agentId: string;
  actorId: string;
  room: string;
  issuedAt: number;
  expiresAt: number;
};

export type MockConnectivityGate = {
  featureEnabled: boolean;
  approvedForSingleSession: boolean;
  providerMode: "disabled" | "mock";
  outboundEnabled: boolean;
};

export type MockConnectivitySession = MockConnectivityRequest & {
  state: MockConnectivityState;
  failure?: MockConnectivityFailure;
  emergencyStopped: boolean;
  cleanupCompleted: boolean;
};

const uuid = z.string().uuid();
const requestSchema = z.object({
  sessionId: uuid,
  organizationId: uuid,
  agentId: uuid,
  actorId: z.string().min(1),
  room: z.string().min(1).max(220),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).strict();

export function mockConnectivityGateFromEnvironment(env: Record<string, string | undefined> = process.env): MockConnectivityGate {
  return {
    featureEnabled: env.VOICE_CONNECTIVITY_TEST_ENABLED === "true",
    approvedForSingleSession: env.VOICE_CONNECTIVITY_TEST_APPROVED === "true",
    providerMode: env.VOICE_PROVIDER_MODE === "mock" ? "mock" : "disabled",
    outboundEnabled: env.VOICE_OUTBOUND_ENABLED === "true",
  };
}

export function isMockConnectivityReady(gate: MockConnectivityGate): boolean {
  return gate.featureEnabled
    && gate.approvedForSingleSession
    && gate.providerMode === "mock"
    && !gate.outboundEnabled;
}

export function validateMockTokenScope(
  request: MockConnectivityRequest,
  expected: Pick<MockConnectivityRequest, "sessionId" | "organizationId" | "agentId" | "actorId">,
  now: number,
  ttlMs = MOCK_CONNECTIVITY_TTL_MS,
): { ok: true } | { ok: false; reason: "invalid_scope" | "expired" } {
  if (!requestSchema.safeParse(request).success) return { ok: false, reason: "invalid_scope" };
  let room: ReturnType<typeof parseVoiceRoomName>;
  try { room = parseVoiceRoomName(request.room); } catch { return { ok: false, reason: "invalid_scope" }; }
  const matches = request.sessionId === expected.sessionId
    && request.organizationId === expected.organizationId
    && request.agentId === expected.agentId
    && request.actorId === expected.actorId
    && room.organizationId === expected.organizationId
    && room.agentId === expected.agentId
    && room.sessionId === expected.sessionId
    && request.expiresAt > request.issuedAt
    && request.expiresAt - request.issuedAt <= ttlMs;
  if (!matches) return { ok: false, reason: "invalid_scope" };
  return request.expiresAt > now ? { ok: true } : { ok: false, reason: "expired" };
}

function authorize(identity: MockConnectivityIdentity, request: MockConnectivityRequest): MockConnectivityFailure | undefined {
  if (!identity.authenticated) return "anonymous";
  if (!identity.actorId || !identity.organizationId) return "unauthorized";
  if (identity.actorId !== request.actorId || identity.organizationId !== request.organizationId) return "unauthorized";
  return undefined;
}

export type MockConnectivityPrepareResult =
  | { ok: true; state: "ready_for_approved_test"; session: MockConnectivitySession }
  | { ok: false; state: "disabled" | "failed"; failure: MockConnectivityFailure };

export class MockLiveKitConnectivityAdapter {
  private readonly sessions = new Map<string, MockConnectivitySession>();
  private stopped = false;

  constructor(
    private readonly gate: MockConnectivityGate = mockConnectivityGateFromEnvironment(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  get label(): string { return MOCK_CONNECTIVITY_LABEL; }

  prepare(identity: MockConnectivityIdentity, request: MockConnectivityRequest): MockConnectivityPrepareResult {
    const authorizationFailure = authorize(identity, request);
    if (authorizationFailure) return { ok: false, state: "failed", failure: authorizationFailure };
    if (!isMockConnectivityReady(this.gate)) return { ok: false, state: "disabled", failure: "disabled" };
    const scope = validateMockTokenScope(request, request, this.now());
    if (!scope.ok) return { ok: false, state: "failed", failure: scope.reason };
    const existing = this.sessions.get(request.sessionId);
    if (existing) return { ok: true, state: "ready_for_approved_test", session: { ...existing } };
    if (this.activeSessionCount() >= 1) return { ok: false, state: "failed", failure: "session_limit" };
    const session: MockConnectivitySession = { ...request, state: "ready_for_approved_test", emergencyStopped: false, cleanupCompleted: false };
    this.sessions.set(request.sessionId, session);
    return { ok: true, state: "ready_for_approved_test", session: { ...session } };
  }

  connect(sessionId: string): MockConnectivitySession {
    const session = this.sessions.get(sessionId);
    if (!session) return this.failed(sessionId, "unauthorized");
    if (this.stopped || session.emergencyStopped) return this.failed(sessionId, "emergency_stopped");
    if (session.expiresAt <= this.now()) return this.failed(sessionId, "expired");
    if (session.state !== "ready_for_approved_test") return this.failed(sessionId, "session_limit");
    session.state = "connecting_mock";
    session.state = "connected_mock";
    return { ...session };
  }

  disconnect(sessionId: string): MockConnectivitySession {
    const session = this.sessions.get(sessionId);
    if (!session) return this.failed(sessionId, "unauthorized");
    session.state = "disconnected";
    session.cleanupCompleted = true;
    return { ...session };
  }

  emergencyStop(): MockConnectivitySession[] {
    this.stopped = true;
    for (const session of this.sessions.values()) {
      session.emergencyStopped = true;
      session.state = "disconnected";
      session.cleanupCompleted = true;
    }
    return this.listSessions();
  }

  cleanup(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  get(sessionId: string): MockConnectivitySession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session } : undefined;
  }

  listSessions(): MockConnectivitySession[] {
    return [...this.sessions.values()].map((session) => ({ ...session }));
  }

  private activeSessionCount(): number {
    return [...this.sessions.values()].filter((session) => ["ready_for_approved_test", "connecting_mock", "connected_mock"].includes(session.state)).length;
  }

  private failed(sessionId: string, failure: MockConnectivityFailure): MockConnectivitySession {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.state = "failed";
      existing.failure = failure;
      return { ...existing };
    }
    return {
      sessionId,
      organizationId: "00000000-0000-4000-8000-000000000000",
      agentId: "00000000-0000-4000-8000-000000000001",
      actorId: "unknown",
      room: "",
      issuedAt: 0,
      expiresAt: 0,
      state: "failed",
      failure,
      emergencyStopped: failure === "emergency_stopped",
      cleanupCompleted: true,
    };
  }
}

export function createMockConnectivityRequest(input: {
  sessionId: string;
  organizationId: string;
  agentId: string;
  actorId: string;
  issuedAt: number;
  expiresAt?: number;
}): MockConnectivityRequest {
  return {
    ...input,
    expiresAt: input.expiresAt ?? input.issuedAt + MOCK_CONNECTIVITY_TTL_MS,
    room: voiceRoomName(input.organizationId, input.agentId, input.sessionId),
  };
}
