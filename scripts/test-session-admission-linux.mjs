import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = { host: process.env.PGHOST || "127.0.0.1", port: process.env.PGPORT || "5432", user: process.env.PGUSER || "postgres", password: process.env.PGPASSWORD || "postgres", database: process.env.PGDATABASE || "postgres" };
const db = `vp_linux_${randomUUID().replaceAll("-", "").slice(0, 18)}`;
const env = { ...process.env, PGPASSWORD: base.password };
const psql = (database, sql, extra = {}) => execFileSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", database, "-At", "-c", sql], { env: { ...env, ...extra }, encoding: "utf8", timeout: 30_000 }).trim();
const run = (database, sql) => psql(database, sql);
const spawnPsql = (database, sql) => new Promise((resolvePromise, reject) => {
  const child = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", database, "-At", "-c", sql], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; let error = "";
  child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
  child.on("error", reject); child.on("close", (code, signal) => code === 0 ? resolvePromise({ output: output.trim(), code, signal }) : reject(new Error(error || `psql exited ${code}`)));
});
const killOwned = async (child) => {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  if (child.exitCode === null) child.kill("SIGKILL");
};
const waitForExit = (child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolvePromise) => child.once("close", resolvePromise));
const uuid = () => randomUUID();
let created = false;
try {
  execFileSync("createdb", ["-h", base.host, "-p", base.port, "-U", base.user, db], { env, timeout: 30_000 }); created = true;
  run(db, "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$; create schema if not exists auth; create table if not exists auth.users(id uuid primary key); create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key);");
  for (const filename of readdirSync(resolve("supabase/migrations")).filter((name) => /^20261022\d+_.+\.sql$/.test(name)).sort()) run(db, readFileSync(resolve("supabase/migrations", filename), "utf8"));
  const actor = uuid(), org = uuid(), agent = uuid(), auth = uuid(), session = uuid(), assertion = uuid(), committedAuth = uuid(), committedSession = uuid(), committedAssertion = uuid();
  run(db, `insert into auth.users(id) values ('${actor}'); insert into public.organizations(id,name,industry,country,timezone,created_by) values ('${org}','Linux synthetic','test','XX','UTC','${actor}'); insert into public.organization_members values ('${org}','${actor}','owner',clock_timestamp()); insert into public.agents(id,organization_id,name,status,created_by) values ('${agent}','${org}','Linux synthetic agent','draft','${actor}'); insert into public.provider_safety_controls(organization_id,emergency_stop) values ('${org}',false); insert into voicepilot_safety.provider_global_stop(singleton,emergency_stop) values (true,false) on conflict(singleton) do update set emergency_stop=false;`);
  const context = `set local role service_role; select set_config('request.jwt.claim.sub','${actor}',true); select set_config('voicepilot.organization_id','${org}',true);`;
  run(db, `begin; ${context} select public.create_voice_session_authorization('${auth}','${org}','${agent}','${actor}','${session}','${assertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); commit;`);
  const beforeCommit = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", db, "-At", "-c", `begin; ${context} select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); select pg_terminate_backend(pg_backend_pid()); commit;`], { env, stdio: ["ignore", "pipe", "pipe"] });
  const beforeExit = waitForExit(beforeCommit);
  await new Promise((resolvePromise, reject) => { beforeCommit.once("error", reject); setTimeout(resolvePromise, 400); });
  await killOwned(beforeCommit); await beforeExit;
  if (run(db, `select count(*) from public.voice_session_authorizations where assertion_id='${assertion}' and consumed_at is not null;`) !== "0") throw new Error("pre-commit crash leaked consumption");
  const recovered = run(db, `begin; ${context} select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  if (!/"reused"\s*:\s*false/.test(recovered)) throw new Error(`post-crash retry did not consume once: ${recovered}`);
  run(db, `begin; ${context} select public.release_voice_session_authorization('${session}','${org}','${actor}'); commit;`);
  run(db, `begin; ${context} select public.create_voice_session_authorization('${committedAuth}','${org}','${agent}','${actor}','${committedSession}','${committedAssertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); select public.consume_voice_session_authorization('${committedAssertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  const lostResult = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", db, "-At", "-c", `select public.consume_voice_session_authorization('${committedAssertion}','${org}','${actor}',clock_timestamp(),1,3600); commit; select pg_terminate_backend(pg_backend_pid());`], { env, stdio: ["ignore", "pipe", "pipe"] });
  const lostExit = waitForExit(lostResult);
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400)); await killOwned(lostResult); await lostExit;
  if (!run(db, `select consumed_at is not null from public.voice_session_authorizations where assertion_id='${committedAssertion}';`).includes("t")) throw new Error("committed state was not durable after lost result");
  let unavailable = false; try { execFileSync("psql", ["-X", "-h", base.host, "-p", "1", "-U", base.user, "-d", db, "-At", "-c", "select 1"], { env, timeout: 2_000, stdio: "ignore" }); } catch { unavailable = true; } if (!unavailable) throw new Error("database-unavailable case did not fail closed");
  const raceAuth = uuid(), raceSession = uuid(), raceAssertion = uuid();
  run(db, `begin; ${context} select public.create_voice_session_authorization('${raceAuth}','${org}','${agent}','${actor}','${raceSession}','${raceAssertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); commit;`);
  const raceContext = `begin; ${context}`;
  const consumeRace = spawnPsql(db, `${raceContext} select public.consume_voice_session_authorization('${raceAssertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  const revokeRace = spawnPsql(db, `${raceContext} select public.revoke_voice_session_authorization('${raceAssertion}','${org}','${actor}'); commit;`);
  const raceResults = await Promise.allSettled([consumeRace, revokeRace]);
  if (raceResults.some((result) => result.status === "rejected")) throw new Error("revocation/consumption race returned an unexpected database error");
  const raceState = psql(db, `select (consumed_at is not null)::text || ':' || (revoked_at is not null)::text from public.voice_session_authorizations where assertion_id='${raceAssertion}'`);
  if (!["true:true", "false:true"].includes(raceState)) throw new Error(`invalid revoke/consume race state: ${raceState}`);
  const repeatedRevoke = run(db, `begin; ${context} select public.revoke_voice_session_authorization('${raceAssertion}','${org}','${actor}'); commit;`);
  if (!/f|false/i.test(repeatedRevoke)) throw new Error(`repeated revocation was not idempotently rejected: ${repeatedRevoke}`);
  const mismatch = run(db, `begin; ${context.replace(org, uuid())} select public.consume_voice_session_authorization('${raceAssertion}','${org}','${actor}',clock_timestamp(),1,3600); rollback;`);
  if (!/tenant_mismatch|unauthorized/i.test(mismatch)) throw new Error(`tenant mismatch was not rejected: ${mismatch}`);

  run(db, `create or replace function public.test_fail_consumed_audit() returns trigger language plpgsql as $$ begin if new.action='consumed' then raise exception 'synthetic audit failure'; end if; return new; end $$; create trigger test_fail_consumed_audit before insert on public.voice_session_audit_events for each row execute function public.test_fail_consumed_audit();`);
  const faultAuth = uuid(), faultSession = uuid(), faultAssertion = uuid();
  run(db, `begin; ${context} select public.create_voice_session_authorization('${faultAuth}','${org}','${agent}','${actor}','${faultSession}','${faultAssertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); commit;`);
  let auditFailed = false; try { run(db, `begin; ${context} select public.consume_voice_session_authorization('${faultAssertion}','${org}','${actor}',clock_timestamp(),10,36000); commit;`); } catch { auditFailed = true; }
  if (!auditFailed) throw new Error("audit fault injection did not fail closed");
  const rolledBack = psql(db, `select (consumed_at is null)::text || ':' || usage_reserved_seconds::text from public.voice_session_authorizations where assertion_id='${faultAssertion}'`);
  if (rolledBack !== "t:0") throw new Error(`audit failure left a partial authorization reservation: ${rolledBack}`);
  run(db, "drop trigger test_fail_consumed_audit on public.voice_session_audit_events; drop function public.test_fail_consumed_audit();");
  const retryAfterFault = run(db, `begin; ${context} select public.consume_voice_session_authorization('${faultAssertion}','${org}','${actor}',clock_timestamp(),10,36000); commit;`);
  if (!/\"ok\"\s*:\s*true/.test(retryAfterFault)) throw new Error(`same authorization could not retry after rollback: ${retryAfterFault}`);
  console.log("LINUX_SESSION_ADMISSION_OK pre-commit crash rollback, post-commit lost-result recovery, replay, revoke/consume race, audit-fault rollback and database-unavailable checks passed");
} finally { if (created) { try { execFileSync("dropdb", ["-h", base.host, "-p", base.port, "-U", base.user, "--if-exists", db], { env, timeout: 30_000, stdio: "ignore" }); } catch { process.exitCode = 1; } } }
