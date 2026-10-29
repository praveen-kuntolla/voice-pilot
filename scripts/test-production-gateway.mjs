import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const docker = "C:\\Users\\PC\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const container = "voicepilot-local-loopback-db-1";
const run = (args, options = {}) => execFileSync(docker, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, ...options }).trim();
const inspect = JSON.parse(run(["inspect", container, "--format", "{{json .}}"]));
if (inspect?.Config?.Labels?.["com.docker.compose.project"] !== "voicepilot-local-loopback" || !inspect?.Mounts?.some((mount) => mount.Name === "voicepilot-local-loopback-db")) throw new Error("Refusing unknown database container or volume");
const ports = run(["ps", "--filter", "label=com.docker.compose.project=voicepilot-local-loopback", "--format", "{{.Ports}}"]);
if (/(?:0\.0\.0\.0|\[::\]):\d+->/.test(ports) || !ports.includes("127.0.0.1:55422->")) throw new Error("Refusing non-loopback PostgreSQL endpoint");
const ledger = run(["exec", container, "psql", "-XAt", "-U", "postgres", "-d", "postgres", "-c", "select string_agg(version,',' order by version) from supabase_migrations.schema_migrations"]);
const expected = Array.from({ length: 11 }, (_, index) => `2026102200${String(index + 1).padStart(2, "0")}`).join(",");
if (ledger !== expected) throw new Error("Established database ledger is not exactly 001-011");

const database = `vp_operational_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const roleSuffix=randomUUID().replaceAll("-","").slice(0,12),oldRole=`vp_gateway_old_${roleSuffix}`,newRole=`vp_gateway_new_${roleSuffix}`,oldPassword=randomUUID(),newPassword=randomUUID();
const actor = randomUUID(), org = randomUUID(), otherOrg = randomUUID(), agent = randomUUID(), contact = randomUUID(), campaign = randomUUID();
const psql = (db, sql) => run(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db], { input: sql });
let created = false;
let rolesCreated=false;
try {
  run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `create database ${database}`]); created = true;
  psql(database, "drop schema public cascade; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  const schema = run(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=public", "--schema=supabase_migrations"]);
  psql(database, schema);
  for (const name of ["202610220012_durable_safety_foundations.sql", "202610220013_transactional_safety.sql", "202610220014_production_gateway_foundations.sql", "202610220015_operational_safety.sql", "202610220016_retry_audit_hardening.sql"]) psql(database, readFileSync(resolve("supabase/migrations", name), "utf8"));
  psql(database, `
    insert into auth.users(id) values('${actor}');
    insert into public.organizations(id,name,industry,country,timezone,created_by) values
      ('${org}','Gateway fixture','test','XX','UTC','${actor}'),('${otherOrg}','Other fixture','test','XX','UTC','${actor}');
    insert into public.organization_members values('${org}','${actor}','owner',clock_timestamp());
    insert into public.agents(id,organization_id,name,status,created_by) values('${agent}','${org}','Offline agent','draft','${actor}');
    insert into public.contacts(id,organization_id,name,consent_status) values('${contact}','${org}','Synthetic contact','granted');
    insert into public.campaigns(id,organization_id,agent_id,name,status,timezone,start_hour,end_hour,consent_required,created_by) values('${campaign}','${org}','${agent}','Offline campaign','test','UTC',0,24,true,'${actor}');
    insert into public.organization_provider_approvals values('${org}','openai','local-reference','${actor}',clock_timestamp(),null,clock_timestamp());
    insert into public.agent_provider_approvals values('${org}','${agent}','openai','${actor}',clock_timestamp(),null,clock_timestamp());
    insert into public.organization_provider_quotas(organization_id,provider,max_concurrent_sessions,updated_by) values('${org}','openai',1,'${actor}');
    insert into public.provider_safety_controls(organization_id,emergency_stop) values('${org}',false);
    insert into voicepilot_safety.provider_global_stop(singleton,emergency_stop) values(true,false) on conflict(singleton) do update set emergency_stop=false;
    insert into voicepilot_safety.provider_limits values('${org}','openai',1,100);
    insert into voicepilot_safety.provider_usage_accounts values('${org}',1000,0,0);
    insert into voicepilot_safety.provider_action_policies values('${org}','${campaign}','${agent}','openai',3,25,true,clock_timestamp());
  `);
  psql(database, `
    create schema voicepilot_test;
    create table voicepilot_test.audit_fault(id boolean primary key default true, should_fail boolean not null default false);
    insert into voicepilot_test.audit_fault(id,should_fail) values(true,false);
    create or replace function voicepilot_test.fail_preparation_audit() returns trigger
      language plpgsql security definer set search_path=pg_catalog,voicepilot_test as $$
      begin
        if new.event_type='preparation_committed' and exists(select 1 from voicepilot_test.audit_fault where id=true and should_fail=true) then
          raise exception 'synthetic preparation audit failure';
        end if;
        return new;
      end $$;
    create trigger test_fail_preparation_audit before insert on voicepilot_safety.gateway_audit_events
      for each row execute function voicepilot_test.fail_preparation_audit();
    grant usage on schema voicepilot_test to service_role;
    grant select,update on voicepilot_test.audit_fault to service_role;
  `);
  psql("postgres",`create role ${oldRole} login password '${oldPassword}'; create role ${newRole} login password '${newPassword}'; grant service_role to ${oldRole},${newRole};`);rolesCreated=true;
  const connectAs=(role,password)=>run(["exec","-e",`PGPASSWORD=${password}`,container,"psql","-XAt","-h","127.0.0.1","-U",role,"-d",database,"-c","select current_user"]);
  if(connectAs(oldRole,oldPassword)!==oldRole||connectAs(newRole,newPassword)!==newRole)throw new Error("Synthetic credential transition failed");
  psql("postgres",`alter role ${oldRole} nologin`);
  let revokedRejected=false;try{connectAs(oldRole,oldPassword);}catch{revokedRejected=true;}if(!revokedRejected)throw new Error("Revoked synthetic credential remained usable");
  console.log("CREDENTIAL_ROTATION_OK synthetic replacement accepted and revoked login rejected");
  const envLines = run(["inspect", "voicepilot-local-loopback-supavisor-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"]); const env = Object.fromEntries(envLines.split(/\r?\n/).filter(Boolean).map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const url = new URL(`postgresql://127.0.0.1:55422/${database}`); url.username = `postgres.${env.POOLER_TENANT_ID}`; url.password = env.POSTGRES_PASSWORD;
  const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "tests/postgres-gateway.integration.test.ts"], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, GATEWAY_DATABASE_URL: url.toString(), GATEWAY_DATABASE_NAME:database, GATEWAY_ACTOR_ID: actor, GATEWAY_ORG_ID: org, GATEWAY_OTHER_ORG_ID: otherOrg, GATEWAY_CAMPAIGN_ID: campaign, GATEWAY_AGENT_ID: agent, GATEWAY_CONTACT_ID: contact } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  if (created) run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `drop database if exists ${database} with (force)`]);
  if(rolesCreated)run(["exec",container,"psql","-Xq","-U","postgres","-d","postgres","-c",`drop role if exists ${oldRole},${newRole}`]);
}
