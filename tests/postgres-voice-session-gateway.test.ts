import { describe, expect, it } from "vitest";
import { createPostgresVoiceAuthorization, releasePostgresVoiceSession, startPostgresVoiceSession } from "@/lib/postgres-voice-session-gateway";
import { signAdmission } from "@/lib/signed-admission";
import type { SessionAuthorization } from "@/lib/durable-session-authorization";
import type { SafetyTransactionExecutor } from "@/lib/privileged-safety-gateway";

const ids = { organizationId: "11111111-1111-4111-8111-111111111111", agentId: "22222222-2222-4222-8222-222222222222", actorId: "33333333-3333-4333-8333-333333333333", sessionId: "44444444-4444-4444-8444-444444444444", assertionId: "55555555-5555-4555-8555-555555555555", authorizationId: "66666666-6666-4666-8666-666666666666" };
const claims = { version: 1 as const, keyId: "offline", assertionId: ids.assertionId, organizationId: ids.organizationId, agentId: ids.agentId, actorId: ids.actorId, sessionId: ids.sessionId, issuedAt: 1000, expiresAt: 2000, capability: "voice_sandbox" as const, maxDurationSeconds: 60, usageLimit: { inputCharacters: 100, outputCharacters: 100 }, providerActivationEnabled: false as const };
const auth: SessionAuthorization = { ...ids, issuedAt: 1000, expiresAt: 2000, capability: "voice_sandbox", maxDurationSeconds: 60 };
const context = { organizationId: ids.organizationId, agentId: ids.agentId, actorId: ids.actorId, sessionId: ids.sessionId, assertionId: ids.assertionId };
const request = { organizationId: ids.organizationId, agentId: ids.agentId, actorId: ids.actorId, sessionId: ids.sessionId, microphoneConsent: true, providerActivationEnabled: false as const, maxDurationSeconds: 60, noRecording: true as const };
const executor: SafetyTransactionExecutor = { transaction: async <T>(work: (query: any) => Promise<T>) => work(async (sql: string) => (sql.includes("consume") ? { rows: [{ result: { ok: true, reused: false } }] } : sql.includes("release") ? { rows: [{ result: true }] } : { rows: [] }) as T) };
const deps = { executor, resolveKey: () => "secret", now: () => 1500, policy: () => ({ emergencyStop: false, concurrencyAvailable: true, usageAvailable: true }), disposableEnvironment: true };

describe("PostgreSQL voice session gateway", () => {
  it("uses the authoritative consume routine and returns simulation-only state", async () => { const result = await startPostgresVoiceSession({ request, admission: { claims, signature: signAdmission(claims, "secret") }, authorization: auth, context }, deps); expect(result).toMatchObject({ ok: true, session: { simulationOnly: true, providerActivationEnabled: false, noRecording: true } }); });
  it("fails closed when disposable isolation is absent or the database is unavailable", async () => { expect((await startPostgresVoiceSession({ request, admission: { claims, signature: signAdmission(claims, "secret") }, authorization: auth, context }, { ...deps, disposableEnvironment: false })).ok).toBe(false); const unavailable: SafetyTransactionExecutor = { transaction: async <T>(_work: (query: any) => Promise<T>): Promise<T> => { throw new Error("db unavailable"); } }; const result = await startPostgresVoiceSession({ request, admission: { claims, signature: signAdmission(claims, "secret") }, authorization: auth, context }, { ...deps, executor: unavailable }); expect(result.ok ? "unexpected" : result.error).toBe("unavailable"); });
  it("uses the release routine and never falls back to memory", async () => { expect(await releasePostgresVoiceSession(context, deps)).toMatchObject({ ok: true, released: true }); expect((await releasePostgresVoiceSession(context, { ...deps, disposableEnvironment: false })).ok).toBe(false); });
  it("creates authorization through the server-side SQL routine", async () => { const result = await createPostgresVoiceAuthorization({ ...ids, issuedAt: 1000, expiresAt: 2000 }, deps); expect(result.ok).toBe(true); });
});
