import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createPostgresVoiceAuthorization, releasePostgresVoiceSession, startPostgresVoiceSession } from "@/lib/postgres-voice-session-gateway";
import { PostgresTransactionExecutor } from "@/lib/postgres-transaction-executor";
import { signAdmission } from "@/lib/signed-admission";
import type { SessionAuthorization } from "@/lib/durable-session-authorization";

const configured = ["GATEWAY_DATABASE_URL", "GATEWAY_ACTOR_ID", "GATEWAY_ORG_ID", "GATEWAY_AGENT_ID"].every((name) => Boolean(process.env[name]));
describe.skipIf(!configured)("real disposable PostgreSQL voice-session adapter", () => {
  const pool = new Pool({ connectionString: process.env.GATEWAY_DATABASE_URL!, max: 2 });
  const executor = new PostgresTransactionExecutor(pool, { statementTimeoutMs: 5000, databaseRole: "service_role" });
  const actorId = process.env.GATEWAY_ACTOR_ID!;
  const organizationId = process.env.GATEWAY_ORG_ID!;
  const agentId = process.env.GATEWAY_AGENT_ID!;
  const now = Date.now();
  afterAll(async () => { await pool.end(); });

  it("creates, consumes, persists, releases and rejects a tenant-mismatched session", async () => {
    const sessionId = crypto.randomUUID();
    const assertionId = crypto.randomUUID();
    const created = await createPostgresVoiceAuthorization({ organizationId, agentId, actorId, sessionId, assertionId, issuedAt: now, expiresAt: now + 300_000 }, { executor, disposableEnvironment: true });
    expect(created.ok).toBe(true);
    const authorizationId = created.ok && created.authorization && typeof created.authorization === "object" && "authorization_id" in created.authorization ? String(created.authorization.authorization_id) : "";
    const authorization: SessionAuthorization = { authorizationId, organizationId, agentId, actorId, sessionId, assertionId, capability: "voice_sandbox", issuedAt: now, expiresAt: now + 300_000, maxDurationSeconds: 60 };
    const claims = { version: 1 as const, keyId: "ci-offline", assertionId, organizationId, agentId, actorId, sessionId, issuedAt: now, expiresAt: now + 300_000, capability: "voice_sandbox" as const, maxDurationSeconds: 60, usageLimit: { inputCharacters: 100, outputCharacters: 100 }, providerActivationEnabled: false as const };
    const context = { organizationId, agentId, actorId, sessionId, assertionId };
    const request = { organizationId, agentId, actorId, sessionId, microphoneConsent: true, providerActivationEnabled: false as const, maxDurationSeconds: 60, noRecording: true as const };
    const deps = { executor, resolveKey: (key: string) => key === "ci-offline" ? "ci-offline-secret" : undefined, now: () => now + 1, policy: () => ({ emergencyStop: false, concurrencyAvailable: true, usageAvailable: true }), disposableEnvironment: true };
    const admitted = await startPostgresVoiceSession({ request, admission: { claims, signature: signAdmission(claims, "ci-offline-secret") }, authorization, context }, deps);
    expect(admitted).toMatchObject({ ok: true, session: { simulationOnly: true, providerActivationEnabled: false, reused: false } });
    const persisted = await pool.query("select consumed_at is not null consumed, released_at is null active from public.voice_session_authorizations where assertion_id=$1", [assertionId]);
    expect(persisted.rows[0]).toEqual({ consumed: true, active: true });
    const released = await releasePostgresVoiceSession(context, { executor, disposableEnvironment: true });
    expect(released).toEqual({ ok: true, released: true });
    expect(await releasePostgresVoiceSession(context, { executor, disposableEnvironment: true })).toEqual({ ok: true, released: false });
    const denied = await startPostgresVoiceSession({ request, admission: { claims, signature: signAdmission(claims, "ci-offline-secret") }, authorization, context: { ...context, organizationId: crypto.randomUUID() } }, deps);
    expect(denied).toMatchObject({ ok: false, error: "tenant_mismatch" });
  });
});
