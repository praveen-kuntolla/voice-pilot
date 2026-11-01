-- REVIEW-ONLY. Apply only to a randomized disposable acceptance database.
-- This migration does not activate or connect any real provider.

create table if not exists voicepilot_safety.provider_session_reservations(
  session_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  expires_at timestamptz not null,
  state text not null default 'active' check(state in ('active','released','expired')),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  unique(organization_id,session_id),
  check(expires_at > created_at)
);
create index if not exists provider_session_reservations_org_idx on voicepilot_safety.provider_session_reservations(organization_id,state,expires_at);
create index if not exists provider_session_reservations_agent_idx on voicepilot_safety.provider_session_reservations(agent_id,state,expires_at);
alter table voicepilot_safety.provider_session_reservations enable row level security;

create table if not exists voicepilot_safety.provider_usage_events(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  session_id uuid not null,
  units bigint not null check(units >= 0),
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,event_id)
);
alter table voicepilot_safety.provider_usage_events enable row level security;
revoke all on voicepilot_safety.provider_session_reservations,voicepilot_safety.provider_usage_accounts,voicepilot_safety.provider_usage_events from public,anon,authenticated;
grant select on voicepilot_safety.provider_session_reservations,voicepilot_safety.provider_usage_accounts,voicepilot_safety.provider_usage_events to service_role;

create or replace function voicepilot_safety.reserve_provider_session(
  p_org uuid,p_agent uuid,p_session uuid,p_expires timestamptz,p_max_org integer,p_max_agent integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,voicepilot_safety as $$
declare existing voicepilot_safety.provider_session_reservations%rowtype; org_count integer; agent_count integer;
begin
  if p_org is null or p_agent is null or p_session is null or p_expires is null or p_expires <= clock_timestamp()
    or p_max_org is null or p_max_org < 1 or p_max_org > 100
    or p_max_agent is null or p_max_agent < 1 or p_max_agent > 100
    or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_org
    or not exists(select 1 from public.agents a where a.id=p_agent and a.organization_id=p_org)
    then return jsonb_build_object('ok',false,'error','unauthorized_or_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended('session:'||p_org::text,0));
  perform pg_advisory_xact_lock(hashtextextended('agent:'||p_agent::text,0));
  update voicepilot_safety.provider_session_reservations set state='expired',released_at=clock_timestamp()
    where state='active' and expires_at<=clock_timestamp();
  select * into existing from voicepilot_safety.provider_session_reservations where session_id=p_session for update;
  if found then
    if existing.organization_id<>p_org or existing.agent_id<>p_agent or existing.expires_at<>p_expires then return jsonb_build_object('ok',false,'error','conflict'); end if;
    if existing.state='active' and existing.expires_at>clock_timestamp() then return jsonb_build_object('ok',true,'reused',true); end if;
    return jsonb_build_object('ok',false,'error','terminal_session');
  end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unauthorized_or_unavailable'); end if;
  select count(*) into org_count from voicepilot_safety.provider_session_reservations where organization_id=p_org and state='active' and expires_at>clock_timestamp();
  select count(*) into agent_count from voicepilot_safety.provider_session_reservations where agent_id=p_agent and state='active' and expires_at>clock_timestamp();
  if org_count>=p_max_org then return jsonb_build_object('ok',false,'error','organization_concurrency'); end if;
  if agent_count>=p_max_agent then return jsonb_build_object('ok',false,'error','agent_concurrency'); end if;
  insert into voicepilot_safety.provider_session_reservations(session_id,organization_id,agent_id,expires_at) values(p_session,p_org,p_agent,p_expires);
  return jsonb_build_object('ok',true,'reused',false);
end $$;

create or replace function voicepilot_safety.release_provider_session(p_org uuid,p_session uuid,p_state text default 'released')
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,voicepilot_safety as $$
begin
  if p_org is null or p_session is null or p_state not in ('released','expired') or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_org then return false; end if;
  update voicepilot_safety.provider_session_reservations set state=p_state,released_at=coalesce(released_at,clock_timestamp()) where organization_id=p_org and session_id=p_session and state='active';
  return found;
end $$;

create or replace function voicepilot_safety.record_provider_usage(p_org uuid,p_event uuid,p_session uuid,p_units bigint,p_max_units bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,voicepilot_safety as $$
declare account voicepilot_safety.provider_usage_accounts%rowtype;
begin
  if p_org is null or p_event is null or p_session is null or p_units is null or p_units<0 or p_units>1000000000 or p_max_units is null or p_max_units<0
    or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_org then return jsonb_build_object('ok',false,'error','invalid_or_unauthorized'); end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:'||p_org::text,0));
  insert into voicepilot_safety.provider_usage_accounts(organization_id,budget_cents) values(p_org,p_max_units) on conflict(organization_id) do update set budget_cents=excluded.budget_cents;
  select * into account from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if exists(select 1 from voicepilot_safety.provider_usage_events where organization_id=p_org and event_id=p_event) then return jsonb_build_object('ok',true,'reused',true,'consumedUnits',account.used_cents); end if;
  if account.used_cents+account.reserved_cents+p_units>account.budget_cents then return jsonb_build_object('ok',false,'error','usage_limit'); end if;
  insert into voicepilot_safety.provider_usage_events(organization_id,event_id,session_id,units) values(p_org,p_event,p_session,p_units);
  update voicepilot_safety.provider_usage_accounts set reserved_cents=reserved_cents+p_units where organization_id=p_org;
  return jsonb_build_object('ok',true,'reused',false,'reservedUnits',account.reserved_cents+p_units);
end $$;

create or replace function voicepilot_safety.settle_provider_usage(p_org uuid,p_event uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,voicepilot_safety as $$
declare units_to_settle bigint;
begin
  if p_org is null or p_event is null or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_org then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:'||p_org::text,0));
  select units into units_to_settle from voicepilot_safety.provider_usage_events where organization_id=p_org and event_id=p_event for update;
  if not found then return false; end if;
  update voicepilot_safety.provider_usage_accounts set reserved_cents=reserved_cents-units_to_settle,used_cents=used_cents+units_to_settle where organization_id=p_org;
  delete from voicepilot_safety.provider_usage_events where organization_id=p_org and event_id=p_event;
  return true;
end $$;

create or replace function voicepilot_safety.release_provider_usage(p_org uuid,p_event uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,voicepilot_safety as $$
declare units_to_release bigint;
begin
  if p_org is null or p_event is null or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_org then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('usage:'||p_org::text,0));
  select units into units_to_release from voicepilot_safety.provider_usage_events where organization_id=p_org and event_id=p_event for update;
  if not found then return false; end if;
  update voicepilot_safety.provider_usage_accounts set reserved_cents=greatest(0,reserved_cents-units_to_release) where organization_id=p_org;
  delete from voicepilot_safety.provider_usage_events where organization_id=p_org and event_id=p_event;
  return true;
end $$;

revoke all on all functions in schema voicepilot_safety from public,anon,authenticated;
grant execute on function voicepilot_safety.reserve_provider_session(uuid,uuid,uuid,timestamptz,integer,integer),voicepilot_safety.release_provider_session(uuid,uuid,text),voicepilot_safety.record_provider_usage(uuid,uuid,uuid,bigint,bigint),voicepilot_safety.settle_provider_usage(uuid,uuid),voicepilot_safety.release_provider_usage(uuid,uuid) to service_role;
