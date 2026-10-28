import { afterAll, describe, expect, it } from "vitest";
import { createDisposableLocalGatewayPool, PostgresTransactionExecutor } from "@/lib/postgres-transaction-executor";
import { PostgresPolicyRepository } from "@/lib/postgres-policy-repository";
import { prepareOfflineProviderAction } from "@/lib/privileged-safety-gateway";

const required = ["GATEWAY_DATABASE_URL", "GATEWAY_ACTOR_ID", "GATEWAY_ORG_ID", "GATEWAY_OTHER_ORG_ID", "GATEWAY_CAMPAIGN_ID", "GATEWAY_AGENT_ID", "GATEWAY_CONTACT_ID"] as const;
const configured = required.every((name) => Boolean(process.env[name]));

describe.skipIf(!configured)("disposable PostgreSQL production-gateway foundation", () => {
  const pool = configured ? createDisposableLocalGatewayPool({ connectionString: process.env.GATEWAY_DATABASE_URL!, max: 4 }) : null!;
  const executor = new PostgresTransactionExecutor(pool, { statementTimeoutMs: 5_000, databaseRole: "service_role" });
  const actor = process.env.GATEWAY_ACTOR_ID!;
  const org = process.env.GATEWAY_ORG_ID!;
  const base = { kind: "reserve" as const, organizationId: org, campaignId: process.env.GATEWAY_CAMPAIGN_ID!, agentId: process.env.GATEWAY_AGENT_ID!, contactId: process.env.GATEWAY_CONTACT_ID! };
  const identity = {
    getVerifiedIdentity: async () => ({ id: actor, expiresAt: Date.now() + 60_000 }),
    getMembership: async (userId: string, organizationId: string) => userId === actor && organizationId === org ? { userId, organizationId, role: "owner" as const } : null,
  };
  const prepare = (idempotencyKey: string, input = base) => prepareOfflineProviderAction({ identity, executor, createPolicyRepository: (query) => new PostgresPolicyRepository(query), now: Date.now, reservationTtlMs: 60_000 }, { ...input, idempotencyKey });

  afterAll(async () => { await pool.end(); });

  it("atomically admits only one action at concurrency one and reserves its budget", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin"); await client.query("set local role service_role"); await client.query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      const repository = new PostgresPolicyRepository(async (sql, values) => ({ rows: (await client.query(sql, [...values])).rows }));
      await expect(repository.load(base)).resolves.not.toBeNull();
      await client.query("rollback");
    } finally { client.release(); }
    const results = await Promise.all([prepare("race-a"), prepare("race-b")]);
    expect(results.every((result) => result.status !== "unavailable"), JSON.stringify(results)).toBe(true);
    expect(results.filter((result) => result.status === "success")).toHaveLength(1);
    expect(results.filter((result) => result.status === "safety_blocked")).toHaveLength(1);
    const row = await pool.query("select count(*)::int actions,(select count(*)::int from voicepilot_safety.provider_usage_reservations where status='active') usage from public.provider_action_reservations where status='active'");
    expect(row.rows[0]).toEqual({ actions: 1, usage: 1 });
  });

  it("rejects duplicate, cross-tenant and removed-membership requests", async () => {
    await expect(prepare("race-a")).resolves.toMatchObject({ status: "safety_blocked" });
    await expect(prepare("other-org", { ...base, organizationId: process.env.GATEWAY_OTHER_ORG_ID! })).resolves.toMatchObject({ status: "denied" });
    await pool.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [org, actor]);
    await expect(prepare("membership-removed")).resolves.toMatchObject({ status: "denied", reason: "resource_not_found" });
  });

  it("rolls back claims and clears transaction-local identity", async () => {
    await expect(executor.transaction(async (query) => {
      await query("select set_config('request.jwt.claim.sub',$1,true)", [actor]);
      await query("select voicepilot_safety.claim_replay($1::uuid,'openai','rollback-proof',clock_timestamp()+interval '5 minutes')", [org]);
      throw new Error("force rollback");
    })).rejects.toThrow("gateway_unavailable");
    const claimed = await executor.transaction(async (query) => (await query<{ result: boolean }>("select voicepilot_safety.claim_replay($1::uuid,'openai','rollback-proof',clock_timestamp()+interval '5 minutes') result", [org])).rows[0].result);
    expect(claimed).toBe(true);
    const context = await executor.transaction(async (query) => (await query<{ actor: string | null }>("select nullif(current_setting('request.jwt.claim.sub',true),'') actor", [])).rows[0].actor);
    expect(context).toBeNull();
  });
});
