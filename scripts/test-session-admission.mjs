import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const docker = "C:\\Users\\PC\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const container = "voicepilot-local-loopback-db-1";
const run = (args, options = {}) => execFileSync(docker, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024, ...options }).trim();
const psql = (db, sql) => run(["exec", "-i", container, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db], { input: sql });
const parallelPsql = (db, sql) => new Promise((resolvePromise, reject) => {
  const child = spawn(docker, ["exec", container, "psql", "-XAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", db, "-c", sql], { windowsHide: true });
  let output = ""; let error = "";
  child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
  child.on("error", reject); child.on("close", (code) => code === 0 ? resolvePromise(output.trim()) : reject(new Error(error || `psql exited ${code}`)));
});
const db = `vp_session_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const actor = randomUUID(), org = randomUUID(), other = randomUUID(), agent = randomUUID(), auth = randomUUID(), session = randomUUID(), assertion = randomUUID();
let created = false;
try {
  run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `create database ${db}`]); created = true;
  psql(db, "drop schema public cascade; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
  const schema = run(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--schema-only", "--no-owner", "--no-privileges", "--schema=public", "--schema=supabase_migrations"]);
  psql(db, schema);
  for (const name of ["202610220012_durable_safety_foundations.sql", "202610220013_transactional_safety.sql", "202610220014_production_gateway_foundations.sql", "202610220015_operational_safety.sql", "202610220016_retry_audit_hardening.sql", "202610220017_durable_session_authorization.sql", "202610220018_transactional_session_admission.sql"]) psql(db, readFileSync(resolve("supabase/migrations", name), "utf8"));
  const setup = `insert into auth.users(id) values ('${actor}'); insert into public.organizations(id,name,industry,country,timezone,created_by) values ('${org}','Synthetic A','test','XX','UTC','${actor}'),('${other}','Synthetic B','test','XX','UTC','${actor}'); insert into public.organization_members values('${org}','${actor}','owner',clock_timestamp()); insert into public.agents(id,organization_id,name,status,created_by) values('${agent}','${org}','Synthetic agent','draft','${actor}'); insert into public.provider_safety_controls(organization_id,emergency_stop) values('${org}',false); insert into voicepilot_safety.provider_global_stop(singleton,emergency_stop) values(true,false) on conflict(singleton) do update set emergency_stop=false;`;
  psql(db, setup);
  const ok = psql(db, `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${org}',true); select public.create_voice_session_authorization('${auth}','${org}','${agent}','${actor}','${session}','${assertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); commit;`);
  if (!ok.includes("voice_sandbox")) throw new Error("authorization creation failed");
  const concurrentSql = `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${org}',true); select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`;
  const concurrent = await Promise.all([parallelPsql(db, concurrentSql), parallelPsql(db, concurrentSql)]);
  if (concurrent.filter((value) => value.includes('"reused": false') || value.includes('"reused":false')).length !== 1) throw new Error("concurrent admission did not produce one authoritative consumption");
  const consumed = psql(db, `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${org}',true); select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  if (!consumed.includes('"ok": true') && !consumed.includes('"ok":true')) throw new Error("consumption failed");
  const replay = psql(db, `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${org}',true); select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  if (!replay.includes('"reused": true') && !replay.includes('"reused":true')) throw new Error("idempotent replay failed");
  const denied = psql(db, `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${other}',true); select public.consume_voice_session_authorization('${assertion}','${other}','${actor}',clock_timestamp(),1,3600); rollback;`);
  if (!denied.includes("tenant_mismatch") && !denied.includes("unauthorized")) throw new Error("cross-tenant rejection failed");
  psql(db, `begin; set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true),set_config('voicepilot.organization_id','${org}',true); select public.release_voice_session_authorization('${session}','${org}','${actor}'); commit;`);
  const audit = psql(db, `select count(*) from public.voice_session_audit_events where authorization_id='${auth}' and action in ('authorized','consumed','released');`);
  if (!audit.split(/\r?\n/).some((line) => line.trim() === "3")) throw new Error("audit lifecycle incomplete");
  console.log("SESSION_ADMISSION_OK disposable PostgreSQL authorization, replay, tenant rejection, release and audit checks passed");
} finally { if (created) run(["exec", container, "psql", "-Xq", "-U", "postgres", "-d", "postgres", "-c", `drop database if exists ${db} with (force)`]); }
