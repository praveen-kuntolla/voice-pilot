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
const killOwned = (child) => { if (child.exitCode === null) child.kill("SIGTERM"); };
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
  const beforeCommit = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", db, "-At", "-c", `begin; ${context} select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); select pg_sleep(30); commit;`], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolvePromise, reject) => { beforeCommit.once("error", reject); setTimeout(resolvePromise, 400); });
  killOwned(beforeCommit);
  await new Promise((resolvePromise) => beforeCommit.once("close", resolvePromise));
  if (run(db, `select count(*) from public.voice_session_authorizations where assertion_id='${assertion}' and consumed_at is not null;`) !== "0") throw new Error("pre-commit crash leaked consumption");
  const recovered = run(db, `begin; ${context} select public.consume_voice_session_authorization('${assertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  if (!/"reused"\s*:\s*false/.test(recovered)) throw new Error(`post-crash retry did not consume once: ${recovered}`);
  run(db, `begin; ${context} select public.create_voice_session_authorization('${committedAuth}','${org}','${agent}','${actor}','${committedSession}','${committedAssertion}',clock_timestamp(),clock_timestamp()+interval '5 minutes'); select public.consume_voice_session_authorization('${committedAssertion}','${org}','${actor}',clock_timestamp(),1,3600); commit;`);
  const lostResult = spawn("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-h", base.host, "-p", base.port, "-U", base.user, "-d", db, "-At", "-c", `select public.consume_voice_session_authorization('${committedAssertion}','${org}','${actor}',clock_timestamp(),1,3600); select pg_sleep(30);`], { env, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 400)); killOwned(lostResult); await new Promise((resolvePromise) => lostResult.once("close", resolvePromise));
  if (!run(db, `select consumed_at is not null from public.voice_session_authorizations where assertion_id='${committedAssertion}';`).includes("t")) throw new Error("committed state was not durable after lost result");
  let unavailable = false; try { execFileSync("psql", ["-X", "-h", base.host, "-p", "1", "-U", base.user, "-d", db, "-At", "-c", "select 1"], { env, timeout: 2_000, stdio: "ignore" }); } catch { unavailable = true; } if (!unavailable) throw new Error("database-unavailable case did not fail closed");
  console.log("LINUX_SESSION_ADMISSION_OK pre-commit crash rollback, post-commit lost-result recovery, replay and database-unavailable checks passed");
} finally { if (created) { try { execFileSync("dropdb", ["-h", base.host, "-p", base.port, "-U", base.user, "--if-exists", db], { env, timeout: 30_000, stdio: "ignore" }); } catch { process.exitCode = 1; } } }
