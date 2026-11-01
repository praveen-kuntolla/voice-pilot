import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const docker = "C:\\Users\\PC\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const container = "voicepilot-local-loopback-db-1";
const run = (args, options = {}) => execFileSync(docker, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, ...options }).trim();
const psql = (db, sql) => run(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db], { input: sql });
const id = () => randomUUID();

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requireUuid = (name, value) => { if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`Invalid disposable fixture ${name}`); return value; };

export function loadSyntheticFixtureIdentity(fixture) {
  const users = fixture?.users;
  if (!Array.isArray(users) || !users[0]) throw new Error("Synthetic fixture users are missing");
  const primary = users[0];
  const actorId = requireUuid("actorId", primary.id);
  const organizationId = requireUuid("organizationId", primary.organization_id);
  const agentId = requireUuid("agentId", primary.agent_id);
  if (primary.organization_id !== organizationId || !primary.agent_id) throw new Error("Synthetic fixture identity is incomplete");
  const second = users[1];
  const otherOrganizationId = second?.organization_id ? requireUuid("otherOrganizationId", second.organization_id) : undefined;
  if (second && second.organization_id === organizationId) throw new Error("Second synthetic fixture must be a different organization");
  return { actorId, organizationId, agentId, otherOrganizationId };
}

export async function startDisposableVoiceGateway(options = {}) {
  const database = `vp_gateway_${id().replaceAll("-", "").slice(0, 12)}`;
  const supplied = options.fixtureIdentity;
  const actorId = supplied?.actorId ? requireUuid("actorId", supplied.actorId) : id();
  const organizationId = supplied?.organizationId ? requireUuid("organizationId", supplied.organizationId) : id();
  const otherOrganizationId = supplied?.otherOrganizationId ? requireUuid("otherOrganizationId", supplied.otherOrganizationId) : id();
  const agentId = supplied?.agentId ? requireUuid("agentId", supplied.agentId) : id();
  const campaignId = supplied?.campaignId ? requireUuid("campaignId", supplied.campaignId) : id();
  if (supplied && (!supplied.actorId || !supplied.organizationId || !supplied.agentId)) throw new Error("External synthetic fixture identity is incomplete");
  let created = false;
  try {
    const inspect = JSON.parse(run(["inspect", container]))[0];
    if (inspect?.Config?.Labels?.["com.docker.compose.project"] !== "voicepilot-local-loopback" || !inspect?.Mounts?.some((mount) => mount.Name === "voicepilot-local-loopback-db")) throw new Error("Refusing non-disposable database container");
    run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `create database ${database}`]); created = true;
    psql(database, "create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
    let schema = run(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=public", "--schema=supabase_migrations"]);
    schema = schema.replace(/^CREATE SCHEMA public;\r?\n/m, "");
    psql(database, schema);
    for (const name of ["202610220012_durable_safety_foundations.sql", "202610220013_transactional_safety.sql", "202610220014_production_gateway_foundations.sql", "202610220015_operational_safety.sql", "202610220016_retry_audit_hardening.sql", "202610220017_durable_session_authorization.sql", "202610220018_transactional_session_admission.sql"]) psql(database, readFileSync(resolve("supabase/migrations", name), "utf8"));
    psql(database, `insert into auth.users(id) values('${actorId}'); insert into public.organizations(id,name,industry,country,timezone,created_by) values('${organizationId}','Gateway fixture','test','XX','UTC','${actorId}'),('${otherOrganizationId}','Other gateway fixture','test','XX','UTC','${actorId}'); insert into public.organization_members values('${organizationId}','${actorId}','owner',clock_timestamp()); insert into public.agents(id,organization_id,name,status,created_by) values('${agentId}','${organizationId}','Gateway agent','draft','${actorId}'); insert into public.campaigns(id,organization_id,agent_id,name,status,timezone,start_hour,end_hour,consent_required,created_by) values('${campaignId}','${organizationId}','${agentId}','Gateway campaign','draft','UTC',0,24,true,'${actorId}'); insert into public.provider_safety_controls(organization_id,emergency_stop) values('${organizationId}',false); insert into voicepilot_safety.provider_global_stop(singleton,emergency_stop) values(true,false) on conflict(singleton) do update set emergency_stop=false; insert into voicepilot_safety.provider_usage_accounts(organization_id,budget_cents,used_cents,reserved_cents) values('${organizationId}',100000,0,0);`);
    const envFile = readFileSync(resolve(".local/supabase-loopback-source/docker/.env"), "utf8");
    const password = envFile.match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1];
    const tenant = run(["inspect", "voicepilot-local-loopback-supavisor-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"]).match(/^POOLER_TENANT_ID=(.*)$/m)?.[1];
    if (!password || !tenant) throw new Error("Loopback Supavisor configuration is incomplete");
    return { database, actorId, organizationId, otherOrganizationId, agentId, campaignId, tenant, gatewayUrl: `postgresql://postgres.${tenant}:${encodeURIComponent(password)}@127.0.0.1:55422/${database}`, async cleanup() { if (!created) return; try { run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `drop database if exists ${database} with (force)`]); created = false; } catch (error) { if (!/does not exist/i.test(String(error))) throw error; } } };
  } catch (error) { if (created) { try { run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `drop database if exists ${database} with (force)`]); } catch {} } throw error; }
}
