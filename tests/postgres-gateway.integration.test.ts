import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDisposableLocalGatewayPool, PostgresTransactionExecutor } from "@/lib/postgres-transaction-executor";
import { PostgresPolicyRepository } from "@/lib/postgres-policy-repository";
import { prepareOfflineProviderAction } from "@/lib/privileged-safety-gateway";
import { OperationalMaintenanceRunner } from "@/lib/operational-maintenance";
import { PostgresDurableSafetyStore } from "@/lib/postgres-durable-safety";
import { PostgresGatewayEventSink } from "@/lib/gateway-audit";

const required = ["GATEWAY_DATABASE_URL","GATEWAY_DATABASE_NAME", "GATEWAY_ACTOR_ID", "GATEWAY_ORG_ID", "GATEWAY_OTHER_ORG_ID", "GATEWAY_CAMPAIGN_ID", "GATEWAY_AGENT_ID", "GATEWAY_CONTACT_ID"] as const;
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
  beforeEach(async () => {
    await pool.query("delete from public.provider_action_reservations where organization_id=$1", [org]);
    await pool.query("delete from voicepilot_safety.provider_usage_reservations where organization_id=$1", [org]);
    await pool.query("delete from public.provider_replay_claims where organization_id=$1", [org]);
    await pool.query("delete from voicepilot_safety.provider_retry_attempts where organization_id=$1", [org]);
    await pool.query("delete from voicepilot_safety.provider_retry_ledger where organization_id=$1", [org]);
    await pool.query("delete from voicepilot_safety.provider_retry_counters where organization_id=$1", [org]);
  });

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
    const attempts=await pool.query("select count(*)::int attempts from voicepilot_safety.provider_retry_attempts");
    expect(attempts.rows[0].attempts).toBe(1);
  });

  it("reconciles and removes expired synthetic retry state idempotently",async()=>{
    await expect(prepare("maintenance-seed")).resolves.toMatchObject({ status: "success" });
    await pool.query("update voicepilot_safety.provider_retry_attempts set expires_at=clock_timestamp()-interval '1 second' where organization_id=$1",[org]);
    const first=await executor.transaction(async(query)=>new OperationalMaintenanceRunner(query,process.env.GATEWAY_DATABASE_NAME!,"trusted-global").run({organizationId:org,before:Date.now(),retentionBefore:Date.now()-86_400_000,batchSize:100}));
    expect(first.retriesReconciled).toBe(1);
    await pool.query("update voicepilot_safety.provider_retry_attempts set finished_at=clock_timestamp()-interval '2 days' where organization_id=$1",[org]);
    const second=await executor.transaction(async(query)=>new OperationalMaintenanceRunner(query,process.env.GATEWAY_DATABASE_NAME!,"trusted-global").run({organizationId:org,before:Date.now(),retentionBefore:Date.now()-86_400_000,batchSize:100}));
    expect(second.retriesRemoved).toBe(1);
    const third=await executor.transaction(async(query)=>new OperationalMaintenanceRunner(query,process.env.GATEWAY_DATABASE_NAME!,"trusted-global").run({organizationId:org,before:Date.now(),retentionBefore:Date.now()-86_400_000,batchSize:100}));
    expect(third.retriesReconciled+third.retriesRemoved).toBe(0);
  });

  it("serializes duplicate retries and enforces the authoritative attempt maximum",async()=>{
    const expiresAt=Date.now()+120_000;
    const reserve=(key:string,attemptKind:"original"|"retry")=>executor.transaction(async(query)=>{await query("select set_config('request.jwt.claim.sub',$1,true),set_config('voicepilot.organization_id',$2,true)",[actor,org]);return new PostgresDurableSafetyStore(query).reserveRetryAttempt({organizationId:org,campaignId:base.campaignId,contactId:base.contactId,agentId:base.agentId,provider:"openai",idempotencyKey:key,attemptKind,maxAttempts:3,expiresAt},Date.now())});
    const duplicate=await Promise.all([reserve("duplicate-retry","original"),reserve("duplicate-retry","original")]);
    expect(duplicate.every((result)=>result.ok)).toBe(true);
    expect(duplicate.filter((result)=>result.ok&&result.reused)).toHaveLength(1);
    const duplicateId=duplicate.find((result)=>result.ok)?.attemptId!;
    const matching=await pool.query("select id,attempt_id from voicepilot_safety.provider_retry_attempts a join voicepilot_safety.provider_retry_ledger l using(organization_id,idempotency_key) where a.id=$1",[duplicateId]);
    expect(matching.rows[0].id).toBe(matching.rows[0].attempt_id);
    await expect(reserve("retry-blocked","retry")).resolves.toMatchObject({ok:false,error:"conflict"});
    await pool.query("select voicepilot_safety.finish_retry_attempt($1::uuid,$2::uuid,'completed')",[org,duplicateId]);
    const competing=await Promise.all([reserve("retry-two","retry"),reserve("retry-three","retry"),reserve("retry-four","retry")]);
    expect(competing.filter((result)=>result.ok)).toHaveLength(1);
    expect(competing.filter((result)=>!result.ok&&result.error==="conflict")).toHaveLength(2);
    const winner=competing.find((result)=>result.ok)!;
    await pool.query("select voicepilot_safety.finish_retry_attempt($1::uuid,$2::uuid,'failed')",[org,winner.attemptId]);
    const third=await reserve("retry-final","retry");
    expect(third).toMatchObject({ok:true,attemptNumber:3});
    if (!third.ok) throw new Error("expected third retry reservation");
    await pool.query("select voicepilot_safety.finish_retry_attempt($1::uuid,$2::uuid,'failed')",[org,third.attemptId]);
    await expect(reserve("retry-exhausted","retry")).resolves.toMatchObject({ok:false,error:"retry_limit"});
    const count=await pool.query("select count(*)::int count from voicepilot_safety.provider_retry_attempts where organization_id=$1",[org]);
    expect(count.rows[0].count).toBe(3);
  });

  it("persists tenant-bound audit events and rejects cross-tenant attribution",async()=>{
    await executor.transaction(async(query)=>{await query("select set_config('voicepilot.organization_id',$1,true)",[org]);await new PostgresGatewayEventSink(query).emit({type:"retry_limit_exhausted",correlationId:"integration-alert",organizationId:org,reason:"retry_limit",occurredAt:Date.now()});});
    const count=await pool.query("select count(*)::int count from voicepilot_safety.gateway_audit_events where organization_id=$1 and correlation_id='integration-alert'",[org]);expect(count.rows[0].count).toBe(1);
    await expect(executor.transaction(async(query)=>{await query("select set_config('voicepilot.organization_id',$1,true)",[org]);await new PostgresGatewayEventSink(query).emit({type:"authorization_denied",correlationId:"cross-tenant",organizationId:process.env.GATEWAY_OTHER_ORG_ID!,reason:"tenant_mismatch",occurredAt:Date.now()});})).rejects.toThrow("gateway_unavailable");
  });

  it("rejects duplicate, cross-tenant and removed-membership requests", async () => {
    await expect(prepare("race-a")).resolves.toMatchObject({ status: "success" });
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
