-- REVIEW ONLY. Do not apply. Proposed Phase 12F worker lease foundation.
create schema if not exists voicepilot_safety;

create table if not exists voicepilot_safety.worker_session_leases (
  lease_id uuid primary key default gen_random_uuid(),
  authorization_id uuid not null references public.voice_session_authorizations(authorization_id),
  organization_id uuid not null references public.organizations(id),
  agent_id uuid not null references public.agents(id),
  actor_id uuid not null references auth.users(id),
  session_id uuid not null,
  assertion_id uuid not null,
  room_name text not null,
  participant_identity text not null,
  worker_key_id text not null,
  status text not null default 'active' check (status in ('active','releasing','released','expired','reconciliation_required')),
  version bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  released_at timestamptz,
  audit_metadata jsonb not null default '{}'::jsonb,
  unique (authorization_id),
  unique (session_id),
  unique (assertion_id),
  check (expires_at > created_at),
  check (status <> 'released' or released_at is not null)
);

create index if not exists worker_lease_reconcile_idx
  on voicepilot_safety.worker_session_leases(status, expires_at);
create index if not exists worker_lease_tenant_idx
  on voicepilot_safety.worker_session_leases(organization_id, agent_id, actor_id);

alter table voicepilot_safety.worker_session_leases enable row level security;
revoke all on voicepilot_safety.worker_session_leases from anon, authenticated;
-- Proposed follow-up: grant only narrowly scoped lease RPC execution to the approved worker gateway role.

-- The following is design-only scaffolding for review. It is intentionally
-- incomplete: no RPCs or grants are provided until the authority and key
-- provisioning decisions are approved.
create table if not exists voicepilot_safety.worker_keys (
  key_id text primary key,
  worker_identity text not null,
  secret_reference text not null,
  status text not null check (status in ('active','revoked','expired')),
  valid_from timestamptz not null,
  valid_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (valid_until is null or valid_until > valid_from)
);

create table if not exists voicepilot_safety.worker_lease_audit_events (
  event_id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references voicepilot_safety.worker_session_leases(lease_id),
  event_type text not null check (event_type in ('created','release_started','released','reconciliation_required','expired')),
  version bigint not null,
  reason text not null check (length(reason) between 1 and 64),
  occurred_at timestamptz not null default clock_timestamp()
);

create unique index if not exists worker_lease_audit_transition_uq
  on voicepilot_safety.worker_lease_audit_events(lease_id, event_type, version);

create or replace function voicepilot_safety.reject_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, voicepilot_safety
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'worker_lease_audit_append_only';
  end if;
  return new;
end; $$;

drop trigger if exists worker_lease_audit_append_only on voicepilot_safety.worker_lease_audit_events;
create trigger worker_lease_audit_append_only
  before update or delete on voicepilot_safety.worker_lease_audit_events
  for each row execute function voicepilot_safety.reject_audit_mutation();

-- Required before implementation: a PostgreSQL room/participant binding table
-- owned by the admission transaction. The current Redis/security-store room
-- authorization cannot participate in the same transaction.
-- Required before implementation: revoke direct mutation from every role and
-- add SECURITY DEFINER RPCs with fixed search_path and least-privilege grants.

-- REVIEW-ONLY CONTRACT EXTENSION. The definitions below are intentionally not
-- part of supabase/migrations and must not be applied without approval.

create table if not exists voicepilot_safety.voice_admission_bindings (
  authorization_id uuid primary key references public.voice_session_authorizations(authorization_id),
  organization_id uuid not null references public.organizations(id),
  agent_id uuid not null references public.agents(id),
  actor_id uuid not null references auth.users(id),
  session_id uuid not null unique,
  assertion_id uuid not null unique,
  room_name text not null unique,
  participant_identity text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  status text not null default 'authorized' check (status in ('authorized','consumed','cancelled','expired')),
  unique (organization_id, session_id),
  check (expires_at > created_at)
);

alter table voicepilot_safety.voice_admission_bindings enable row level security;

create table if not exists voicepilot_safety.provider_termination_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references voicepilot_safety.worker_session_leases(lease_id),
  source text not null check (source in ('server','provider')),
  room_name text not null,
  participant_identity text not null,
  session_id uuid not null,
  terminal_state text not null check (terminal_state in ('terminated','failed','unreachable')),
  evidence_digest text not null,
  observed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (lease_id, evidence_digest)
);

alter table voicepilot_safety.provider_termination_evidence enable row level security;

create table if not exists voicepilot_safety.worker_release_nonces (
  key_id text not null references voicepilot_safety.worker_keys(key_id),
  path text not null,
  nonce text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (key_id, path, nonce)
);

create index if not exists worker_release_nonce_expiry_idx
  on voicepilot_safety.worker_release_nonces(expires_at);

-- The following signatures define the only intended mutation surface. Bodies
-- must lock all rows in a deterministic order and set request-local claims.
-- They are shown as contracts, not executable deployment SQL.
--
-- create_worker_lease(p_authorization_id uuid, p_worker_key_id text,
--   p_room_name text, p_participant_identity text, p_now timestamptz,
--   p_expires_at timestamptz) returns jsonb;
-- begin_worker_release(p_lease_id uuid, p_worker_key_id text,
--   p_release_attempt_id uuid, p_now timestamptz) returns jsonb;
-- complete_worker_release(p_lease_id uuid, p_worker_key_id text,
--   p_release_attempt_id uuid, p_evidence_id uuid,
--   p_now timestamptz) returns jsonb;
-- mark_worker_reconciliation_required(p_lease_id uuid, p_reason text,
--   p_now timestamptz) returns boolean;
-- reconcile_expired_worker_lease(p_lease_id uuid, p_evidence_id uuid,
--   p_now timestamptz) returns jsonb;

-- Required implementation predicates for create_worker_lease:
-- 1. SELECT ... FOR UPDATE on authorization and voice_admission_bindings.
-- 2. Verify organization_members and agents.organization_id.
-- 3. Verify every binding column equals the authorization row.
-- 4. Verify worker_keys.status='active' and validity interval contains p_now.
-- 5. Verify authorization is consumed, unrevoked, unexpired, and not released.
-- 6. Insert exactly one lease and one immutable audit row in the same tx.
-- Any error rolls back consumption/lease/audit together.

-- Required implementation predicates for complete_worker_release:
-- 1. Lock lease, evidence, and authorization FOR UPDATE.
-- 2. Verify lease.worker_key_id, room, participant, session, and organization.
-- 3. Require evidence.source in ('server','provider') and terminal_state in
--    ('terminated','failed'); worker-reported completion is insufficient.
-- 4. Invoke the existing tenant-bound authorization release operation.
-- 5. Transition only releasing -> released, increment version, and append one
--    audit event. Repeated attempts return already_released without capacity
--    mutation. Unreachable evidence retains capacity.

-- Required privilege model after RPC bodies are approved:
-- revoke all on voicepilot_safety.voice_admission_bindings,
--   voicepilot_safety.worker_session_leases,
--   voicepilot_safety.worker_keys,
--   voicepilot_safety.provider_termination_evidence,
--   voicepilot_safety.worker_release_nonces,
--   voicepilot_safety.worker_lease_audit_events
--   from public, anon, authenticated;
-- grant execute on the five narrowly scoped RPCs to voice_worker_gateway;
-- grant usage on schema voicepilot_safety to voice_worker_gateway;
-- no direct table SELECT/INSERT/UPDATE/DELETE is granted to that role.

-- Rollback contract: disable RPC callers and feature flags, preserve all lease,
-- evidence, nonce, and audit rows, and reconcile active rows. Never drop these
-- tables while active or reconciliation_required leases exist.

-- EXECUTABLE REVIEW CONTRACTS BELOW. Review-only: do not apply.
-- The deployment must replace these comments with an approved migration owner
-- and role ownership before any environment is changed.

alter table voicepilot_safety.worker_session_leases
  add constraint worker_lease_auth_identity_fk
  foreign key (authorization_id) references public.voice_session_authorizations(authorization_id);

create unique index if not exists worker_lease_active_authorization_uq
  on voicepilot_safety.worker_session_leases(authorization_id)
  where status in ('active','releasing','reconciliation_required');

create table if not exists voicepilot_safety.worker_release_attempts (
  release_attempt_id uuid primary key,
  lease_id uuid not null references voicepilot_safety.worker_session_leases(lease_id),
  key_id text not null references voicepilot_safety.worker_keys(key_id),
  created_at timestamptz not null default clock_timestamp(),
  unique (lease_id, release_attempt_id)
);

create or replace function voicepilot_safety.claim_worker_release_nonce(
  p_key_id text, p_path text, p_nonce text, p_expires_at timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, voicepilot_safety
as $$
begin
  if p_key_id is null or p_path is null or p_nonce is null or length(p_nonce) not between 16 and 128
     or p_path not in ('/api/internal/voice-agent/release','/api/internal/voice-agent/reconcile')
     or p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '5 minutes'
     or not exists (select 1 from voicepilot_safety.worker_keys k
                    where k.key_id=p_key_id and k.status='active'
                      and k.valid_from <= clock_timestamp()
                      and (k.valid_until is null or clock_timestamp() < k.valid_until)) then return false; end if;
  insert into voicepilot_safety.worker_release_nonces(key_id,path,nonce,expires_at)
    values(p_key_id,p_path,p_nonce,p_expires_at);
  return true;
exception when unique_violation then return false;
end; $$;

;

;

;

create or replace function voicepilot_safety.mark_worker_reconciliation_required(
  p_lease_id uuid, p_reason text, p_now timestamptz
) returns boolean
language plpgsql security definer
set search_path = pg_catalog, voicepilot_safety
as $$
begin
  -- Authorization is provided by EXECUTE on this function to the approved
  -- reconciliation role. Do not use current_user here: SECURITY DEFINER
  -- changes current_user to the function owner.
  if p_reason is null or length(p_reason) not between 1 and 64
     or abs(extract(epoch from (clock_timestamp()-p_now))) > 60 then
    return false;
  end if;
  perform 1 from voicepilot_safety.worker_session_leases where lease_id=p_lease_id for update;
  if not found then return false; end if;
  update voicepilot_safety.worker_session_leases set status='reconciliation_required',version=version+1 where lease_id=p_lease_id and status in ('active','releasing');
  if not found then return false; end if;
  insert into voicepilot_safety.worker_lease_audit_events(lease_id,event_type,version,reason) select lease_id,'reconciliation_required',version,left(p_reason,64) from voicepilot_safety.worker_session_leases where lease_id=p_lease_id;
  return true;
end; $$;

;

-- Review-only privilege contract. Replace with approved role ownership and
-- explicit grants after security review; never grant direct table mutation.
-- revoke all on all tables in schema voicepilot_safety from public,anon,authenticated,voice_worker_gateway;
-- revoke all on all functions in schema voicepilot_safety from public,anon,authenticated;
-- grant execute on function voicepilot_safety.claim_worker_release_nonce(text,text,text,timestamptz), voicepilot_safety.create_worker_lease(uuid,text,text,text,timestamptz,timestamptz), voicepilot_safety.begin_worker_release(uuid,text,uuid,timestamptz), voicepilot_safety.complete_worker_release(uuid,text,uuid,uuid,timestamptz), voicepilot_safety.mark_worker_reconciliation_required(uuid,text,timestamptz), voicepilot_safety.reconcile_expired_worker_lease(uuid,uuid,timestamptz) to voice_worker_gateway;

-- CORRECTED CONTRACT OVERRIDES (review-only). These definitions address the
-- independent review findings; they still require syntax/SQL acceptance and
-- approved role ownership before use.
create or replace function voicepilot_safety.create_worker_lease(
  p_authorization_id uuid, p_worker_key_id text, p_room_name text,
  p_participant_identity text, p_now timestamptz, p_expires_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, voicepilot_safety as $$
declare a public.voice_session_authorizations; b voicepilot_safety.voice_admission_bindings; k voicepilot_safety.worker_keys; l voicepilot_safety.worker_session_leases; consumed jsonb;
begin
  select * into a from public.voice_session_authorizations where authorization_id=p_authorization_id for update;
  select * into b from voicepilot_safety.voice_admission_bindings where authorization_id=p_authorization_id for update;
  select * into k from voicepilot_safety.worker_keys where key_id=p_worker_key_id for update;
  if a.authorization_id is null or b.authorization_id is null or k.key_id is null
     or k.status<>'active' or p_now<k.valid_from or (k.valid_until is not null and p_now>=k.valid_until)
     or a.organization_id<>b.organization_id or a.agent_id<>b.agent_id or a.actor_id<>b.actor_id
     or a.session_id<>b.session_id or a.assertion_id<>b.assertion_id or b.room_name<>p_room_name
     or b.participant_identity<>p_participant_identity or b.status<>'authorized'
     or b.expires_at<=p_now or a.revoked_at is not null or a.consumed_at is not null
     or a.released_at is not null or a.expires_at<=p_now or p_expires_at<=p_now or p_expires_at>a.expires_at
     or not exists(select 1 from public.organization_members m where m.organization_id=a.organization_id and m.user_id=a.actor_id and m.role in ('owner','admin','member'))
     or not exists(select 1 from public.agents g where g.id=a.agent_id and g.organization_id=a.organization_id)
     or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from a.organization_id then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;
  perform set_config('request.jwt.claim.sub',a.actor_id::text,true);
  perform set_config('voicepilot.organization_id',a.organization_id::text,true);
  consumed := public.consume_voice_session_authorization(a.assertion_id,a.organization_id,a.actor_id,p_now,1,extract(epoch from (a.expires_at-a.issued_at))::integer);
  if coalesce((consumed->>'ok')::boolean,false) is not true then raise exception 'authorization_consumption_failed'; end if;
  insert into voicepilot_safety.worker_session_leases(authorization_id,organization_id,agent_id,actor_id,session_id,assertion_id,room_name,participant_identity,worker_key_id,status,expires_at)
    values(a.authorization_id,a.organization_id,a.agent_id,a.actor_id,a.session_id,a.assertion_id,b.room_name,b.participant_identity,k.key_id,'active',p_expires_at)
    returning * into l;
  insert into voicepilot_safety.worker_lease_audit_events(lease_id,event_type,version,reason) values(l.lease_id,'created',l.version,'worker_config');
  return jsonb_build_object('ok',true,'lease_id',l.lease_id,'session_id',l.session_id);
exception when unique_violation then return jsonb_build_object('ok',false,'error','duplicate_lease');
end; $$;

create or replace function voicepilot_safety.begin_worker_release(
  p_lease_id uuid,p_worker_key_id text,p_release_attempt_id uuid,p_now timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, voicepilot_safety as $$
declare l voicepilot_safety.worker_session_leases; k voicepilot_safety.worker_keys; prior bigint;
begin
  select * into l from voicepilot_safety.worker_session_leases where lease_id=p_lease_id for update;
  select * into k from voicepilot_safety.worker_keys where key_id=p_worker_key_id for update;
  if l.lease_id is null or l.worker_key_id<>p_worker_key_id or k.key_id is null
     or k.status<>'active' or p_now<k.valid_from or (k.valid_until is not null and p_now>=k.valid_until)
     or abs(extract(epoch from (clock_timestamp()-p_now))) > 60 then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if l.status='released' then return jsonb_build_object('ok',true,'status','already_released','version',l.version); end if;
  if l.status not in ('active','releasing') or l.expires_at<=p_now then return jsonb_build_object('ok',false,'error','reconciliation_required'); end if;
  if p_release_attempt_id is null then return jsonb_build_object('ok',false,'error','invalid_attempt'); end if;
  insert into voicepilot_safety.worker_release_attempts(release_attempt_id,lease_id,key_id,created_at)
    values(p_release_attempt_id,l.lease_id,p_worker_key_id,p_now)
    on conflict (release_attempt_id) do nothing;
  if not exists (select 1 from voicepilot_safety.worker_release_attempts x
                 where x.release_attempt_id=p_release_attempt_id and x.lease_id=l.lease_id and x.key_id=p_worker_key_id)
    then return jsonb_build_object('ok',false,'error','attempt_replay'); end if;
  update voicepilot_safety.worker_session_leases set status='releasing',version=version+1 where lease_id=l.lease_id and version=l.version and status='active' returning version into prior;
  if not found then return jsonb_build_object('ok',true,'status','releasing','version',l.version); end if;
  insert into voicepilot_safety.worker_lease_audit_events(lease_id,event_type,version,reason) values(l.lease_id,'release_started',prior,'worker_request');
  return jsonb_build_object('ok',true,'status','releasing','version',prior);
end; $$;

create or replace function voicepilot_safety.complete_worker_release(
  p_lease_id uuid,p_worker_key_id text,p_release_attempt_id uuid,p_evidence_id uuid,p_now timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, voicepilot_safety as $$
declare l voicepilot_safety.worker_session_leases; e voicepilot_safety.provider_termination_evidence; a public.voice_session_authorizations; k voicepilot_safety.worker_keys; released boolean;
begin
  select * into l from voicepilot_safety.worker_session_leases where lease_id=p_lease_id for update;
  select * into e from voicepilot_safety.provider_termination_evidence where evidence_id=p_evidence_id and lease_id=p_lease_id for update;
  select * into a from public.voice_session_authorizations where authorization_id=l.authorization_id for update;
  select * into k from voicepilot_safety.worker_keys where key_id=p_worker_key_id for update;
  if l.lease_id is null or l.worker_key_id<>p_worker_key_id or k.key_id is null
     or k.status<>'active' or p_now<k.valid_from or (k.valid_until is not null and p_now>=k.valid_until)
     or e.evidence_id is null or e.source not in ('server','provider') or e.terminal_state not in ('terminated','failed')
     or e.room_name<>l.room_name or e.participant_identity<>l.participant_identity or e.session_id<>l.session_id
     or l.status='reconciliation_required' or abs(extract(epoch from (clock_timestamp()-p_now))) > 60 then return jsonb_build_object('ok',false,'error','termination_unconfirmed'); end if;
  if l.status='released' then return jsonb_build_object('ok',true,'status','already_released'); end if;
  if l.status<>'releasing' or not exists(select 1 from voicepilot_safety.worker_release_attempts x where x.release_attempt_id=p_release_attempt_id and x.lease_id=l.lease_id and x.key_id=p_worker_key_id) then return jsonb_build_object('ok',false,'error','invalid_transition'); end if;
  perform set_config('request.jwt.claim.sub',a.actor_id::text,true);
  perform set_config('voicepilot.organization_id',a.organization_id::text,true);
  released := public.release_voice_session_authorization(a.session_id,a.organization_id,a.actor_id);
  if released is not true then raise exception 'authorization_release_failed'; end if;
  update voicepilot_safety.worker_session_leases set status='released',released_at=p_now,version=version+1 where lease_id=l.lease_id and version=l.version and status='releasing';
  if not found then raise exception 'stale_lease_version'; end if;
  insert into voicepilot_safety.worker_lease_audit_events(lease_id,event_type,version,reason) values(l.lease_id,'released',l.version+1,'termination_confirmed');
  return jsonb_build_object('ok',true,'status','released');
end; $$;

create or replace function voicepilot_safety.reconcile_expired_worker_lease(
  p_lease_id uuid,p_evidence_id uuid,p_now timestamptz
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, auth, voicepilot_safety as $$
declare l voicepilot_safety.worker_session_leases; e voicepilot_safety.provider_termination_evidence; a public.voice_session_authorizations; released boolean;
begin
  -- Authorization is provided by EXECUTE on this function to the approved
  -- reconciliation role. The function owner is non-login and is not the
  -- caller identity.
  select * into l from voicepilot_safety.worker_session_leases where lease_id=p_lease_id for update;
  select * into e from voicepilot_safety.provider_termination_evidence where evidence_id=p_evidence_id and lease_id=p_lease_id for update;
  select * into a from public.voice_session_authorizations where authorization_id=l.authorization_id for update;
  if l.lease_id is null or l.expires_at>p_now or e.evidence_id is null or e.source not in ('server','provider') or e.terminal_state not in ('terminated','failed') or e.room_name<>l.room_name or e.participant_identity<>l.participant_identity or e.session_id<>l.session_id then return jsonb_build_object('ok',false,'error','termination_unconfirmed'); end if;
  if l.status='released' then return jsonb_build_object('ok',true,'status','already_released'); end if;
  if l.status not in ('expired','reconciliation_required') then return jsonb_build_object('ok',false,'error','invalid_transition'); end if;
  perform set_config('request.jwt.claim.sub',a.actor_id::text,true);
  perform set_config('voicepilot.organization_id',a.organization_id::text,true);
  released := public.release_voice_session_authorization(a.session_id,a.organization_id,a.actor_id);
  if released is not true then raise exception 'authorization_release_failed'; end if;
  update voicepilot_safety.worker_session_leases set status='released',released_at=p_now,version=version+1 where lease_id=l.lease_id and status in ('expired','reconciliation_required');
  if not found then raise exception 'stale_lease_state'; end if;
  insert into voicepilot_safety.worker_lease_audit_events(lease_id,event_type,version,reason) values(l.lease_id,'released',l.version+1,'reconciled');
  return jsonb_build_object('ok',true,'status','released');
end; $$;

-- Evidence may only be inserted by an independently approved server/provider
-- adapter. Workers and browser roles must never receive INSERT on this table.
create or replace function voicepilot_safety.record_provider_termination_evidence(
  p_lease_id uuid, p_source text, p_room_name text, p_participant_identity text,
  p_session_id uuid, p_terminal_state text, p_evidence_digest text,
  p_observed_at timestamptz, p_now timestamptz
) returns uuid language plpgsql security definer
set search_path = pg_catalog, voicepilot_safety as $$
declare l voicepilot_safety.worker_session_leases; v_id uuid;
begin
  -- Fail closed until an approved evidence adapter is provisioned. The
  -- eventual producer boundary is EXECUTE on this function plus verified
  -- provider/server evidence; p_source is never authorization evidence.
  raise exception 'termination_evidence_producer_unconfigured';
  if p_source not in ('server','provider') or p_terminal_state not in ('terminated','failed')
     or p_evidence_digest is null or length(p_evidence_digest) not between 32 and 256
     or abs(extract(epoch from (clock_timestamp()-p_now))) > 60
     or p_observed_at > p_now or p_observed_at < p_now - interval '10 minutes' then
    raise exception 'termination_evidence_denied';
  end if;
  select * into l from voicepilot_safety.worker_session_leases where lease_id=p_lease_id for update;
  if l.lease_id is null or l.room_name<>p_room_name or l.participant_identity<>p_participant_identity or l.session_id<>p_session_id then
    raise exception 'termination_evidence_mismatch';
  end if;
  insert into voicepilot_safety.provider_termination_evidence(lease_id,source,room_name,participant_identity,session_id,terminal_state,evidence_digest,observed_at)
    values(p_lease_id,p_source,p_room_name,p_participant_identity,p_session_id,p_terminal_state,p_evidence_digest,p_observed_at)
    returning evidence_id into v_id;
  return v_id;
end; $$;

-- Deny default execution. The approved role owner must later grant only the
-- release functions to a dedicated gateway role; no direct table mutation is
-- permitted. Do not invent that role here if it is absent in the target DB.
revoke all on all tables in schema voicepilot_safety from public, anon, authenticated;
revoke all on all functions in schema voicepilot_safety from public, anon, authenticated;
-- Candidate role contract; deployment must create these roles through the
-- approved DBA process. This review-only file intentionally creates no roles.
-- voicepilot_safety_owner: NOLOGIN, owns functions/tables, never used by apps.
-- voice_worker_gateway: NOLOGIN/NOSUPERUSER, receives only release RPCs.
-- voice_reconciliation_operator: NOLOGIN/NOSUPERUSER, receives only
-- reconciliation RPCs.
-- voice_evidence_ingestor: NOLOGIN/NOSUPERUSER, receives only evidence RPC.
-- Candidate grants after owner approval:
-- grant usage on schema voicepilot_safety to voice_worker_gateway, voice_reconciliation_operator, voice_evidence_ingestor;
-- grant execute on function voicepilot_safety.claim_worker_release_nonce(text,text,text,timestamptz), voicepilot_safety.create_worker_lease(uuid,text,text,text,timestamptz,timestamptz), voicepilot_safety.begin_worker_release(uuid,text,uuid,timestamptz), voicepilot_safety.complete_worker_release(uuid,text,uuid,uuid,timestamptz) to voice_worker_gateway;
-- grant execute on function voicepilot_safety.mark_worker_reconciliation_required(uuid,text,timestamptz), voicepilot_safety.reconcile_expired_worker_lease(uuid,uuid,timestamptz) to voice_reconciliation_operator;
-- grant execute on function voicepilot_safety.record_provider_termination_evidence(uuid,text,text,text,uuid,text,text,timestamptz,timestamptz) to voice_evidence_ingestor;
-- No candidate role receives direct SELECT/INSERT/UPDATE/DELETE on protected tables.

-- Actual lock-order contract:
-- * admission creation: authorization -> admission binding -> worker key ->
--   lease insert -> audit insert; consume_voice_session_authorization then
--   re-locks the already-held authorization and takes its organization
--   advisory transaction lock.
-- * worker release: lease -> evidence -> authorization -> worker key ->
--   release-attempt check -> audit insert. Both completion and reconciliation
--   use this same order; the nested release RPC receives an already-held
--   authorization row.
-- * begin release: lease -> worker key -> release-attempt insert -> audit.
-- * reconciliation marking: lease -> audit.
-- * evidence ingestion: lease -> evidence insert.
-- * nonce claim: worker key validation -> nonce insert.
-- This is not one global order because release must discover authorization via
-- the lease and evidence must bind to the lease. Cross-family concurrency
-- tests are still required; this comment does not claim deadlock freedom.
