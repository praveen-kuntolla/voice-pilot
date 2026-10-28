// Disposable, local-only PostgreSQL integration test. Creates and drops only
// its own randomly named database; never writes to the established app DB.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const docker = "C:\\Users\\PC\\AppData\\Local\\Programs\\DockerDesktop\\resources\\bin\\docker.exe";
const container = "voicepilot-local-loopback-db-1";
const exec = (args) => execFileSync(docker, args, { encoding: "utf8", timeout: 30_000 }).trim();
const inspect = JSON.parse(exec(["inspect", container, "--format", "{{json .}}"])) ;
if (inspect?.Config?.Labels?.["com.docker.compose.project"] !== "voicepilot-local-loopback" ||
  !inspect?.Mounts?.some((mount) => mount.Type === "volume" && mount.Name === "voicepilot-local-loopback-db") ||
  inspect?.Mounts?.some((mount) => mount.Name === "supabase_db_voicepilot-ai")) throw new Error("Refusing unknown database container or volume");
const published = exec(["ps", "--filter", "label=com.docker.compose.project=voicepilot-local-loopback", "--format", "{{json .}}"]).split(/\r?\n/).map(JSON.parse);
if (!published.some((row) => row.Names === "voicepilot-local-loopback-api-gw-1" && row.Ports.includes("127.0.0.1:55421->")) ||
  !published.some((row) => row.Names === "voicepilot-local-loopback-supavisor-1" && row.Ports.includes("127.0.0.1:55422->")) ||
  published.some((row) => /(?:0\.0\.0\.0|\[::\]):\d+->/.test(row.Ports))) throw new Error("Refusing non-loopback or unexpected published endpoints");
const ledger = exec(["exec", container, "psql", "-X", "-At", "-U", "postgres", "-d", "postgres", "-c", "select string_agg(version,',' order by version) from supabase_migrations.schema_migrations"]);
if (ledger !== Array.from({ length: 11 }, (_, n) => `2026102200${String(n + 1).padStart(2, "0")}`).join(",")) throw new Error("Unexpected established migration ledger");
const testDb = `vp_safety_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
const psql = (database, sql) => exec(["exec", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database, "-c", sql]);
const streamSql = (database, sql) => new Promise((resolvePromise, reject) => {
  const child = spawn(docker, ["exec", "-i", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (data) => { out += data; });
  child.stderr.on("data", (data) => { err += data; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolvePromise(out.trim()) : reject(new Error(`Local psql failed (${code}): ${err.slice(0, 500)}`)));
  child.stdin.end(sql);
});
const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const expect = (actual, wanted, name) => { if (actual !== wanted) throw new Error(`${name}: expected ${wanted}, got ${actual}`); console.log(`PASS ${name}`); };
const orgA = randomUUID(), orgB = randomUUID(), actor = randomUUID(), outsider = randomUUID();
const asActor = (sql, identity = actor) => psql(testDb, `begin; set local request.jwt.claim.sub='${identity}'; ${sql}; commit;`)
  .split(/\r?\n/).filter((line) => !["BEGIN", "SET", "COMMIT"].includes(line)).join("\n");
let created = false;
try {
  exec(["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `create database ${testDb}`]);
  created = true;
  await streamSql(testDb, `create schema auth; create table auth.users(id uuid primary key); create type public.member_role as enum ('owner','admin','member','viewer'); create table public.organizations(id uuid primary key); create table public.organization_members(organization_id uuid,user_id uuid,role public.member_role); insert into auth.users values('${actor}'),('${outsider}'); insert into public.organizations values('${orgA}'),('${orgB}'); insert into public.organization_members values('${orgA}','${actor}','owner'),('${orgB}','${actor}','admin'),('${orgB}','${outsider}','member');`);
  for (const filename of ["202610220012_durable_safety_foundations.sql", "202610220013_transactional_safety.sql"]) {
    const body = readFileSync(resolve("supabase/migrations", filename), "utf8");
    await streamSql(testDb, `begin;\n${body}\ncommit;`);
  }
  expect(psql(testDb, "select has_schema_privilege('authenticated','voicepilot_safety','usage')"), "f", "voicepilot_safety schema hidden from authenticated");
  expect(psql(testDb, "select has_table_privilege('service_role','public.provider_safety_controls','select'); select has_table_privilege('service_role','voicepilot_safety.provider_global_stop','select')"), "t\nt", "service role has minimum control reads");
  expect(psql(testDb, "select has_table_privilege('service_role','public.provider_safety_controls','insert,update,delete,truncate'); select has_table_privilege('service_role','voicepilot_safety.provider_global_stop','insert,update,delete,truncate')"), "f\nf", "service role has no direct control mutation");
  expect(psql(testDb, "select has_table_privilege('anon','public.provider_safety_controls','select,insert,update,delete,truncate'); select has_table_privilege('authenticated','voicepilot_safety.provider_global_stop','select,insert,update,delete,truncate')"), "f\nf", "client roles have no control table privileges");
  expect(psql(testDb, "select count(*) from information_schema.routine_privileges where specific_schema='voicepilot_safety' and grantee='PUBLIC'"), "0", "no public privileged routine execution");
  expect(psql(testDb, "select has_function_privilege('authenticated','voicepilot_safety.claim_replay(uuid,text,text,timestamptz)','execute')"), "f", "no authenticated replay execution");
  expect(psql(testDb, "select has_function_privilege('anon','voicepilot_safety.set_global_stop(boolean,uuid)','execute')"), "f", "no anonymous control execution");
  expect(psql(testDb, "select has_function_privilege('service_role','voicepilot_safety.claim_replay(uuid,text,text,timestamptz)','execute')"), "t", "service-only replay execution");
  expect(psql(testDb, "select count(*) from pg_indexes where schemaname in ('public','voicepilot_safety') and indexname in ('provider_replay_claims_expiry_idx','provider_action_reservations_active_idx','provider_usage_ledger_org_time_idx')"), "3", "required migration indexes exist");
  expect(psql(testDb, "select count(*) from information_schema.tables where table_schema='voicepilot_safety' and table_name like 'provider_%'"), "7", "private safety tables created");
  expect(psql(testDb, `select voicepilot_safety.safety_enabled('${orgA}')`), "f", "missing control fails closed");
  expect(asActor(`select voicepilot_safety.set_global_stop(false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',false,'${outsider}'); select voicepilot_safety.set_budget('${orgA}',100,'${outsider}')`, outsider), "f\nf\nf", "unauthorized control changes rejected");
  expect(psql(testDb, `insert into voicepilot_safety.provider_global_operators(actor_id,enabled) values('${actor}',true); select true`), "INSERT 0 1\nt", "offline global operator fixture");
  expect(psql(testDb, `select voicepilot_safety.set_global_stop(false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',false,'${actor}')`), "f\nf", "missing actor context fails closed");
  expect(asActor(`select voicepilot_safety.set_global_stop(false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgB}',false,'${actor}')`), "t\nt\nt", "explicit control setup");
  expect(asActor(`select voicepilot_safety.set_global_stop(true,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',true,'${actor}'); select voicepilot_safety.set_limits('${orgA}','mock',9,9,'${actor}'); select voicepilot_safety.set_budget('${orgA}',999,'${actor}')`, outsider), "f\nf\nf\nf", "spoofed privileged actor rejected");
  expect(psql(testDb, `begin; select set_config('request.jwt.claim.sub','${actor}',true); select set_config('voicepilot.organization_id','${orgA}',true); select current_setting('request.jwt.claim.sub',true) || ':' || current_setting('voicepilot.organization_id',true); commit; select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'cleared') || ':' || coalesce(nullif(current_setting('voicepilot.organization_id',true),''),'cleared')`), `BEGIN\n${actor}\n${orgA}\n${actor}:${orgA}\nCOMMIT\ncleared:cleared`, "transaction-local gateway identity cleared on pooled connection reuse");
  expect(psql(testDb, `begin; select set_config('request.jwt.claim.sub','${actor}',true); select set_config('voicepilot.organization_id','${orgA}',true); rollback; select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),'cleared') || ':' || coalesce(nullif(current_setting('voicepilot.organization_id',true),''),'cleared')`), `BEGIN\n${actor}\n${orgA}\nROLLBACK\ncleared:cleared`, "transaction rollback clears gateway identity");
  expect(psql(testDb, `set role service_role; select emergency_stop from voicepilot_safety.provider_global_stop where singleton=true; select emergency_stop from public.provider_safety_controls where organization_id='${orgA}'; reset role`), "SET\nf\nf\nRESET", "service role reads false control state");
  expect(asActor(`select voicepilot_safety.set_global_stop(true,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',true,'${actor}'); set role service_role; select emergency_stop from voicepilot_safety.provider_global_stop where singleton=true; select emergency_stop from public.provider_safety_controls where organization_id='${orgA}'; reset role; select voicepilot_safety.set_global_stop(false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',false,'${actor}')`), "t\nt\nt\nt\nRESET\nt\nt", "service role reads true control state");
  expect(psql(testDb, `set role service_role; select count(*) from public.provider_safety_controls where organization_id='00000000-0000-0000-0000-000000000000'; reset role`), "SET\n0\nRESET", "service role observes missing organization control");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','before-limits',1,'2099-01-01')`)).ok, false, "missing capacity policy fails closed");
  expect(asActor(`select voicepilot_safety.set_limits('${orgA}','mock',1,1,'${outsider}')`, outsider), "f", "ordinary member cannot set limits");
  expect(asActor(`select voicepilot_safety.set_limits('${orgA}','mock',1,1,'${actor}'); select voicepilot_safety.set_limits('${orgB}','mock',1,1,'${actor}')`), "t\nt", "admin-only authoritative limits");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','wrong-limit',2,'2099-01-01')`)).ok, false, "caller cannot raise capacity limit");
  expect(psql(testDb, `select voicepilot_safety.claim_rate('${orgA}','mock',2)`), "f", "caller cannot raise rate limit");
  expect(asActor(`select voicepilot_safety.set_budget('${orgA}',100,'${actor}')`), "t", "budget setup");
  const expires = "2099-01-01T00:00:00Z";
  const race = (sql) => Promise.allSettled([streamSql(testDb, sql), streamSql(testDb, sql)]);
  let results = await race(`select voicepilot_safety.claim_replay('${orgA}','mock','race','${expires}')`);
  expect(results.map((r) => r.status === "fulfilled" ? r.value : "error").sort().join(","), "f,t", "atomic concurrent replay claim");
  expect(psql(testDb, `select voicepilot_safety.claim_replay('${orgB}','mock','race','${expires}')`), "t", "tenant-bound replay identity");
  expect(psql(testDb, `select voicepilot_safety.claim_replay('${orgA}','other-provider','race','${expires}')`), "t", "provider-bound replay identity");
  expect(psql(testDb, `select voicepilot_safety.claim_replay('${orgA}','mock','expired','2000-01-01')`), "f", "expired claim rejected");
  expect(psql(testDb, `update public.provider_replay_claims set expires_at='2000-01-01' where organization_id='${orgA}' and provider='mock' and event_id='race'; select voicepilot_safety.claim_replay('${orgA}','mock','race','${expires}')`), "UPDATE 1\nt", "expired replay reclaimed");
  expect(psql(testDb, `select voicepilot_safety.cleanup_replay(clock_timestamp(),100)`), "0", "live replay retained");
  psql(testDb, `update public.provider_replay_claims set expires_at='2000-01-01' where organization_id='${orgA}' and provider='other-provider'`);
  expect(psql(testDb, `select voicepilot_safety.cleanup_replay(clock_timestamp(),100); select voicepilot_safety.claim_replay('${orgA}','other-provider','race','${expires}')`), "1\nt", "expired replay cleanup and reuse");
  psql(testDb, `update public.provider_replay_claims set expires_at='2000-01-01' where organization_id='${orgA}' and provider='other-provider'`);
  const heldCleanupRow = streamSql(testDb, `begin; select 1 from public.provider_replay_claims where organization_id='${orgA}' and provider='other-provider' for update; select pg_sleep(0.7); commit;`);
  await delay(200);
  expect(psql(testDb, "select voicepilot_safety.cleanup_replay(clock_timestamp(),100)"), "0", "cleanup skips locked rows without unsafe blocking");
  await heldCleanupRow;
  expect(psql(testDb, "select voicepilot_safety.cleanup_replay(clock_timestamp(),100)"), "1", "cleanup succeeds on bounded retry");
  expect(psql(testDb, `select voicepilot_safety.claim_rate('${orgA}','mock',1); select voicepilot_safety.claim_rate('${orgA}','mock',1); select voicepilot_safety.claim_rate('${orgB}','mock',1)`), "t\nf\nt", "tenant-bound rate window");
  psql(testDb, `insert into voicepilot_safety.provider_rate_windows values('${orgA}','mock','2000-01-01',1)`);
  expect(psql(testDb, "select voicepilot_safety.cleanup_rate_windows(date_trunc('minute',clock_timestamp())-interval '1 minute',100)"), "1", "old rate bucket cleanup");
  results = await Promise.allSettled([
    streamSql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','a',1,'${expires}')`),
    streamSql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','b',1,'${expires}')`),
  ]);
  expect(results.filter((r) => r.status === "fulfilled" && JSON.parse(r.value).ok).length, 1, "one remaining concurrency slot");
  expect(psql(testDb, `select count(*) from public.provider_action_reservations where organization_id='${orgA}'`), "1", "reservation count bounded");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','a',1,'${expires}')`)).ok || JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','b',1,'${expires}')`)).ok, true, "reservation idempotency");
  const active = psql(testDb, `select idempotency_key || ':' || id from public.provider_action_reservations where organization_id='${orgA}'`);
  const [activeKey, activeId] = active.split(":");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','${activeKey}',1,'2099-01-02')`)).error, "conflict", "conflicting reservation key rejected");
  expect(psql(testDb, `select voicepilot_safety.release_action('${orgB}','mock','${activeId}'); select voicepilot_safety.release_action('${orgA}','mock','${activeId}')`), "f\nt", "tenant-scoped release");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','${activeKey}',1,'${expires}')`)).error, "conflict", "released reservation key cannot restart");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','new',1,'${expires}')`)).ok, true, "released capacity recovered");
  const globalOperation = streamSql(testDb, `begin; select voicepilot_safety.reserve_action('${orgB}','mock','global-race',1,'${expires}'); select pg_sleep(0.8); commit;`);
  await delay(200);
  const globalStopStarted = Date.now();
  expect(await streamSql(testDb, `begin; set local request.jwt.claim.sub='${actor}'; select voicepilot_safety.set_global_stop(true,'${actor}'); commit;`), "BEGIN\nSET\nt\nCOMMIT", "global stop wins after pending operation boundary");
  expect(Date.now() - globalStopStarted >= 400, true, "global stop waits for safety-checked transaction");
  await globalOperation;
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','blocked-after-global-stop',1,'${expires}')`)).ok, false, "fresh operation blocked after global stop");
  expect(asActor(`select voicepilot_safety.set_global_stop(false,'${actor}')`), "t", "global stop cleared after drill");
  expect(asActor(`select voicepilot_safety.set_limits('${orgA}','org-race',1,1,'${actor}')`), "t", "organization race provider configured");
  const organizationOperation = streamSql(testDb, `begin; select voicepilot_safety.reserve_action('${orgA}','org-race','org-race',1,'${expires}'); select pg_sleep(0.8); commit;`);
  await delay(200);
  const organizationStopStarted = Date.now();
  expect(await streamSql(testDb, `begin; set local request.jwt.claim.sub='${actor}'; select voicepilot_safety.set_organization_stop('${orgA}',true,'${actor}'); commit;`), "BEGIN\nSET\nt\nCOMMIT", "organization stop wins after pending operation boundary");
  expect(Date.now() - organizationStopStarted >= 400, true, "organization stop waits for safety-checked transaction");
  await organizationOperation;
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','org-race','blocked',1,'${expires}')`)).ok, false, "fresh operation blocked after organization stop");
  expect(asActor(`select voicepilot_safety.set_organization_stop('${orgA}',false,'${actor}')`), "t", "organization stop cleared after drill");
  results = await Promise.allSettled([
    streamSql(testDb, `select voicepilot_safety.record_usage('${orgA}','u1',60,100)`),
    streamSql(testDb, `select voicepilot_safety.record_usage('${orgA}','u2',60,100)`),
  ]);
  expect(results.filter((r) => r.status === "fulfilled" && JSON.parse(r.value).ok).length, 1, "atomic shared budget");
  expect(psql(testDb, `select used_cents from voicepilot_safety.provider_usage_accounts where organization_id='${orgA}'`), "60", "usage counted once");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.record_usage('${orgA}','u1',61,100)`)).ok, false, "conflicting usage rejected");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.record_usage('${orgB}','u1',1,100)`)).ok, false, "other tenant lacks budget");
  expect(asActor(`select voicepilot_safety.set_global_stop(true,'${actor}'); select voicepilot_safety.safety_enabled('${orgA}')`), "t\nf", "global stop authoritative");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_action('${orgA}','mock','stopped',2,'${expires}')`)).ok, false, "global stop blocks reservations");
  expect(asActor(`select voicepilot_safety.set_global_stop(false,'${actor}'); select voicepilot_safety.set_organization_stop('${orgA}',true,'${actor}'); select voicepilot_safety.safety_enabled('${orgA}'); select voicepilot_safety.safety_enabled('${orgB}')`), "t\nt\nf\nt", "organization stop isolated");
  expect(asActor(`select voicepilot_safety.set_organization_stop('${orgA}',false,'${actor}')`), "t", "organization stop cleared");
  expect(asActor(`select voicepilot_safety.set_global_stop(false,'${outsider}'); select voicepilot_safety.set_organization_stop('${orgA}',true,'${outsider}')`, outsider), "f\nf", "outsider cannot change control state");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_usage('${orgA}','reservation',40,100,'${expires}')`)).ok, true, "usage reserved");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.settle_usage('${orgA}','reservation',41)`)).ok, false, "usage settlement above reservation rejected");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.settle_usage('${orgA}','reservation',30)`)).ok, true, "usage settled");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.settle_usage('${orgA}','reservation',30)`)).recorded, false, "settlement idempotent");
  expect(psql(testDb, `select used_cents || ':' || reserved_cents from voicepilot_safety.provider_usage_accounts where organization_id='${orgA}'`), "90:0", "settlement account totals");
  expect(asActor(`select voicepilot_safety.set_budget('${orgA}',89,'${actor}')`), "f", "cannot reduce budget below committed usage");
  expect(JSON.parse(psql(testDb, `select voicepilot_safety.reserve_usage('${orgA}','expiring',10,100,clock_timestamp()+interval '1 hour')`)).ok, true, "usage reservation accepted");
  psql(testDb, `update voicepilot_safety.provider_usage_reservations set expires_at=clock_timestamp()-interval '1 second' where organization_id='${orgA}' and idempotency_key='expiring'`);
  expect(psql(testDb, `select voicepilot_safety.expire_usage('${orgA}',10); select reserved_cents from voicepilot_safety.provider_usage_accounts where organization_id='${orgA}'`), "1\n0", "expired reservation recovered");
  expect(psql(testDb, `begin; select voicepilot_safety.claim_replay('${orgA}','mock','rollback','${expires}'); rollback; select voicepilot_safety.claim_replay('${orgA}','mock','rollback','${expires}')`), "BEGIN\nt\nROLLBACK\nt", "transaction rollback releases claim");
  let interrupted = false; try { await streamSql(testDb, "begin; set local statement_timeout='1ms'; select pg_sleep(0.1); commit;"); } catch { interrupted = true; }
  expect(interrupted, true, "disposable database statement interruption");
  expect(psql(testDb, `select voicepilot_safety.claim_replay('${orgA}','mock','after-interruption','${expires}')`), "t", "database recovers after cancelled statement");
  let denied = false; try { psql(testDb, "set role authenticated; select * from public.provider_replay_claims"); } catch { denied = true; }
  expect(denied, true, "authenticated direct table access denied");
  denied = false; try { psql(testDb, "set role anon; select * from public.provider_safety_controls"); } catch { denied = true; }
  expect(denied, true, "anonymous control read denied");
  denied = false; try { psql(testDb, `set role authenticated; update public.provider_safety_controls set emergency_stop=true where organization_id='${orgA}'`); } catch { denied = true; }
  expect(denied, true, "authenticated control mutation denied");
  denied = false; try { psql(testDb, `set role authenticated; select voicepilot_safety.claim_replay('${orgA}','mock','forbidden','${expires}')`); } catch { denied = true; }
  expect(denied, true, "authenticated privileged routine execution denied");
  expect(psql(testDb, "select count(*) > 0 from voicepilot_safety.provider_safety_audit"), "t", "control and accounting audit written");
  expect(psql(testDb, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='voicepilot_safety' and p.prosecdef and p.proconfig @> array['search_path=pg_catalog']"), psql(testDb, "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='voicepilot_safety'"), "all privileged routines fix search_path");
  console.log("POSTGRES_SAFETY_OK disposable local database and transaction-context tests passed");
  await streamSql(testDb, `begin;
    revoke all on all functions in schema voicepilot_safety from service_role;
    drop schema voicepilot_safety cascade;
    drop table public.provider_usage_ledger;
    drop table public.provider_action_reservations;
    drop table public.provider_safety_controls;
    drop table public.provider_replay_claims;
    commit;`);
  expect(psql(testDb, "select count(*) from information_schema.schemata where schema_name='voicepilot_safety'; select count(*) from information_schema.tables where table_schema='public' and table_name like 'provider_%'; select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='voicepilot_safety'; select count(*) from public.organizations; select count(*) from auth.users"), "0\n0\n0\n2\n2", "rollback removes only safety objects and preserves fixtures");
  console.log("ROLLBACK_OK migration 012-013 rollback rehearsal passed");
} finally {
  if (created) {
    exec(["exec", container, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-c", `drop database ${testDb} with (force)`]);
    console.log("CLEANUP_OK disposable safety database dropped");
  }
}
