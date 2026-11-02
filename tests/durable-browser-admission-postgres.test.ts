import { describe, expect, it } from "vitest";
import { authorizeDurableBrowserSession, type DurableBrowserAdmission, type DurableBrowserAdmissionGateway } from "@/lib/durable-browser-admission";

const request = { organizationId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222", actorId: "33333333-3333-4333-8333-333333333333", sessionId: "44444444-4444-4444-8444-444444444444", assertionId: "55555555-5555-4555-8555-555555555555", room: "voicepilot:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:44444444-4444-4444-8444-444444444444", participantIdentity: "33333333-3333-4333-8333-333333333333" };

class DisposableAdmissionAdapter implements DurableBrowserAdmissionGateway {
  private readonly rows = new Map<string, DurableBrowserAdmission>();
  private readonly activeSessions = new Set<string>();
  private activeReservations = 0;
  constructor(private readonly maxConcurrent = 1, private readonly fail = false) {}
  seed(row: DurableBrowserAdmission) { this.rows.set(row.sessionId, row); }
  release(sessionId: string) { if (!this.activeSessions.delete(sessionId)) return false; this.activeReservations = Math.max(0, this.activeReservations - 1); return true; }
  async authorize(input: typeof request): Promise<DurableBrowserAdmission | null> {
    if (this.fail || this.activeReservations >= this.maxConcurrent) return null;
    const row = this.rows.get(input.sessionId);
    if (!row || row.organizationId !== input.organizationId || row.agentId !== input.agentId || row.actorId !== input.actorId || row.assertionId !== input.assertionId || row.room !== input.room || row.participantIdentity !== input.participantIdentity || row.reservationState !== "active") return null;
    this.activeReservations += 1;
    this.rows.delete(input.sessionId);
    this.activeSessions.add(input.sessionId);
    return row;
  }
}

function row(overrides: Partial<DurableBrowserAdmission> = {}): DurableBrowserAdmission {
  return { ...request, reservationId: "reservation-1", reservationState: "active", expiresAt: 2_000, ...overrides };
}

describe("disposable PostgreSQL admission adapter contract", () => {
  it("requires one atomic reservation and rejects duplicate admission", async () => {
    const adapter = new DisposableAdmissionAdapter();
    adapter.seed(row());
    await expect(authorizeDurableBrowserSession(adapter, request, 1_000)).resolves.toMatchObject({ ok: true });
    await expect(authorizeDurableBrowserSession(adapter, request, 1_000)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
  });

  it("rejects cross-tenant, cross-agent and altered session/assertion/room identities", async () => {
    const adapter = new DisposableAdmissionAdapter();
    adapter.seed(row());
    await expect(authorizeDurableBrowserSession(adapter, { ...request, organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, 1_000)).resolves.toMatchObject({ ok: false });
    await expect(authorizeDurableBrowserSession(adapter, { ...request, agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, 1_000)).resolves.toMatchObject({ ok: false });
    await expect(authorizeDurableBrowserSession(adapter, { ...request, assertionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, 1_000)).resolves.toMatchObject({ ok: false });
    await expect(authorizeDurableBrowserSession(adapter, { ...request, room: request.room.replace(request.sessionId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") }, 1_000)).resolves.toMatchObject({ ok: false });
  });

  it("rejects expired authorization and missing reservation", async () => {
    const expired = new DisposableAdmissionAdapter(); expired.seed(row({ expiresAt: 1_000 }));
    await expect(authorizeDurableBrowserSession(expired, request, 1_000)).resolves.toEqual({ ok: false, reason: "expired" });
    const missing = new DisposableAdmissionAdapter();
    await expect(authorizeDurableBrowserSession(missing, request, 1_000)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
  });

  it("denies concurrency and database failure without issuing a token", async () => {
    const first = new DisposableAdmissionAdapter(1); first.seed(row());
    await expect(authorizeDurableBrowserSession(first, request, 1_000)).resolves.toMatchObject({ ok: true });
    const second = new DisposableAdmissionAdapter(1); second.seed(row()); second.seed(row({ sessionId: "66666666-6666-4666-8666-666666666666", assertionId: "77777777-7777-4777-8777-777777777777", room: "voicepilot:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:66666666-6666-4666-8666-666666666666" }));
    await expect(authorizeDurableBrowserSession(second, request, 1_000)).resolves.toMatchObject({ ok: true });
    await expect(authorizeDurableBrowserSession(second, { ...request, sessionId: "66666666-6666-4666-8666-666666666666", assertionId: "77777777-7777-4777-8777-777777777777", room: "voicepilot:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:66666666-6666-4666-8666-666666666666" }, 1_000)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
    await expect(authorizeDurableBrowserSession(new DisposableAdmissionAdapter(1, true), request, 1_000)).resolves.toEqual({ ok: false, reason: "gateway_unavailable" });
    expect(first.release(request.sessionId)).toBe(true);
    expect(first.release(request.sessionId)).toBe(false);
  });
});
