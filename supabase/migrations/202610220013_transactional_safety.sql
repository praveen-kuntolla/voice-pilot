-- REVIEW ONLY. Apply with 012 only in a verified disposable local database.
-- Privileged routines live outside PostgREST's exposed public schema. No live
-- provider path invokes them. Service callers must independently authorize org.
create schema if not exists voicepilot_safety;
revoke all on schema voicepilot_safety from public, anon, authenticated;
grant usage on schema voicepilot_safety to service_role;

alter table public.provider_action_reservations add column if not exists max_concurrent integer not null default 1 check(max_concurrent > 0);
alter table public.provider_action_reservations add column if not exists status text not null default 'active' check(status in ('active','released','expired'));
alter table public.provider_usage_ledger add column if not exists budget_cents bigint not null default 0 check(budget_cents >= 0);

create table if not exists voicepilot_safety.provider_global_stop (
  singleton boolean primary key default true check(singleton),
  emergency_stop boolean not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table if not exists voicepilot_safety.provider_global_operators (
  actor_id uuid primary key references auth.users(id), enabled boolean not null default false
);
create table if not exists voicepilot_safety.provider_usage_accounts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  budget_cents bigint not null check(budget_cents between 0 and 9007199254740991),
  used_cents bigint not null default 0 check(used_cents >= 0),
  reserved_cents bigint not null default 0 check(reserved_cents >= 0),
  check(used_cents + reserved_cents <= budget_cents)
);
create table if not exists voicepilot_safety.provider_usage_reservations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null,
  amount_cents bigint not null check(amount_cents >= 0),
  actual_cents bigint check(actual_cents >= 0),
  expires_at timestamptz not null,
  status text not null default 'active' check(status in ('active','settled','expired')),
  primary key(organization_id,idempotency_key)
);
create table if not exists voicepilot_safety.provider_rate_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  minute_bucket timestamptz not null,
  hits integer not null check(hits > 0),
  primary key(organization_id,provider,minute_bucket)
);
create table if not exists voicepilot_safety.provider_limits (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(length(trim(provider)) between 1 and 80),
  max_concurrent integer not null check(max_concurrent between 1 and 100000),
  max_per_minute integer not null check(max_per_minute between 1 and 100000),
  primary key(organization_id,provider)
);
create table if not exists voicepilot_safety.provider_safety_audit (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  action text not null,
  actor_id uuid references auth.users(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on all tables in schema voicepilot_safety from public, anon, authenticated;
revoke all on public.provider_replay_claims, public.provider_safety_controls,
  public.provider_action_reservations, public.provider_usage_ledger from public, anon, authenticated;
-- The server adapter reads only these two control tables. Mutations remain
-- restricted to the SECURITY DEFINER routines below.
grant select on public.provider_safety_controls to service_role;
grant select on voicepilot_safety.provider_global_stop to service_role;
alter table voicepilot_safety.provider_global_stop enable row level security;
alter table voicepilot_safety.provider_global_operators enable row level security;
alter table voicepilot_safety.provider_usage_accounts enable row level security;
alter table voicepilot_safety.provider_usage_reservations enable row level security;
alter table voicepilot_safety.provider_rate_windows enable row level security;
alter table voicepilot_safety.provider_limits enable row level security;
alter table voicepilot_safety.provider_safety_audit enable row level security;

create or replace function voicepilot_safety.current_actor() returns uuid
language plpgsql stable security definer set search_path = pg_catalog as $$
declare raw_actor text;
begin
  raw_actor := nullif(current_setting('request.jwt.claim.sub',true),'');
  if raw_actor is null or raw_actor !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return null; end if;
  return raw_actor::uuid;
exception when others then return null;
end $$;

create or replace function voicepilot_safety.safety_enabled(p_org uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare g boolean; o boolean;
begin
  if p_org is null then return false; end if;
  -- Shared transaction locks make the final safety check atomic with respect to
  -- global and organization stop changes until the caller transaction ends.
  perform pg_advisory_xact_lock_shared(hashtextextended('voicepilot:global-stop',0));
  perform pg_advisory_xact_lock_shared(hashtextextended('voicepilot:organization-stop:' || p_org::text,0));
  select emergency_stop into g from voicepilot_safety.provider_global_stop where singleton = true for share;
  select emergency_stop into o from public.provider_safety_controls where organization_id = p_org for share;
  return g is false and o is false;
end $$;

create or replace function voicepilot_safety.set_global_stop(p_stop boolean, p_actor uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_stop is null or p_actor is null or voicepilot_safety.current_actor() is distinct from p_actor or not exists(
    select 1 from voicepilot_safety.provider_global_operators where actor_id=p_actor and enabled=true
  ) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voicepilot:global-stop',0));
  insert into voicepilot_safety.provider_global_stop(singleton, emergency_stop) values(true,p_stop)
    on conflict(singleton) do update set emergency_stop=excluded.emergency_stop,updated_at=clock_timestamp();
  insert into voicepilot_safety.provider_safety_audit(action,actor_id,detail) values('global_stop',p_actor,jsonb_build_object('enabled',p_stop));
  return true;
end $$;

create or replace function voicepilot_safety.set_organization_stop(p_org uuid, p_stop boolean, p_actor uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_org is null or p_stop is null or p_actor is null or voicepilot_safety.current_actor() is distinct from p_actor or not exists(
    select 1 from public.organization_members where organization_id=p_org and user_id=p_actor and role in ('owner','admin')
  ) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('voicepilot:organization-stop:' || p_org::text,0));
  insert into public.provider_safety_controls(organization_id,emergency_stop,updated_by)
    values(p_org,p_stop,p_actor) on conflict(organization_id) do update
    set emergency_stop=excluded.emergency_stop,updated_by=excluded.updated_by,updated_at=clock_timestamp();
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,actor_id,detail)
    values(p_org,'organization_stop',p_actor,jsonb_build_object('enabled',p_stop));
  return true;
end $$;

create or replace function voicepilot_safety.claim_replay(p_org uuid,p_provider text,p_event text,p_expires timestamptz) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare claimed boolean;
begin
  if p_org is null or p_provider is null or length(trim(p_provider)) not between 1 and 80
    or p_event is null or length(trim(p_event)) not between 1 and 256
    or p_expires is null or p_expires <= clock_timestamp() then return false; end if;
  insert into public.provider_replay_claims(organization_id,provider,event_id,expires_at)
    values(p_org,p_provider,p_event,p_expires)
    on conflict(organization_id,provider,event_id) do update
    set expires_at=excluded.expires_at,claimed_at=clock_timestamp()
    where public.provider_replay_claims.expires_at <= clock_timestamp()
    returning true into claimed;
  return coalesce(claimed,false);
end $$;

create or replace function voicepilot_safety.cleanup_replay(p_before timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_before is null or p_before > clock_timestamp() or p_limit is null or p_limit not between 1 and 10000 then return 0; end if;
  with victims as (select ctid from public.provider_replay_claims where expires_at <= p_before
    order by expires_at limit p_limit for update skip locked), removed as (
    delete from public.provider_replay_claims where ctid in (select ctid from victims) returning 1)
  select count(*) into n from removed;
  return n;
end $$;

create or replace function voicepilot_safety.set_limits(p_org uuid,p_provider text,p_max integer,p_rate integer,p_actor uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_org is null or p_provider is null or length(trim(p_provider)) not between 1 and 80
    or p_max is null or p_max not between 1 and 100000 or p_rate is null or p_rate not between 1 and 100000
    or p_actor is null or voicepilot_safety.current_actor() is distinct from p_actor or not exists(select 1 from public.organization_members
      where organization_id=p_org and user_id=p_actor and role in ('owner','admin')) then return false; end if;
  insert into voicepilot_safety.provider_limits(organization_id,provider,max_concurrent,max_per_minute)
    values(p_org,p_provider,p_max,p_rate) on conflict(organization_id,provider) do update
    set max_concurrent=excluded.max_concurrent,max_per_minute=excluded.max_per_minute;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,actor_id,detail)
    values(p_org,'limits_set',p_actor,jsonb_build_object('provider',p_provider,'maxConcurrent',p_max,'maxPerMinute',p_rate));
  return true;
end $$;

create or replace function voicepilot_safety.reserve_action(p_org uuid,p_provider text,p_key text,p_max integer,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare prior public.provider_action_reservations%rowtype; n integer; new_id uuid; configured_max integer;
begin
  if p_org is null or p_provider is null or length(trim(p_provider)) not between 1 and 80
    or p_key is null or length(trim(p_key)) not between 1 and 256 or p_max is null or p_max not between 1 and 100000
    or p_expires is null or p_expires <= clock_timestamp() then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || length(p_provider) || ':' || p_provider,0));
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select max_concurrent into configured_max from voicepilot_safety.provider_limits where organization_id=p_org and provider=p_provider for share;
  if configured_max is null or configured_max <> p_max then return jsonb_build_object('ok',false,'error','unavailable_or_conflict'); end if;
  update public.provider_action_reservations set status='expired' where organization_id=p_org and provider=p_provider and status='active' and expires_at <= clock_timestamp();
  select * into prior from public.provider_action_reservations where organization_id=p_org and provider=p_provider and idempotency_key=p_key;
  if found then
    if prior.status <> 'active' or prior.max_concurrent <> p_max or prior.expires_at <> p_expires then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'reservationId',prior.id,'reused',true);
  end if;
  select count(*) into n from public.provider_action_reservations where organization_id=p_org and provider=p_provider and status='active' and expires_at > clock_timestamp();
  if n >= p_max then return jsonb_build_object('ok',false,'error','concurrency_limit'); end if;
  insert into public.provider_action_reservations(organization_id,provider,idempotency_key,max_concurrent,expires_at)
    values(p_org,p_provider,p_key,p_max,p_expires) returning id into new_id;
  return jsonb_build_object('ok',true,'reservationId',new_id,'reused',false);
end $$;

create or replace function voicepilot_safety.release_action(p_org uuid,p_provider text,p_id uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_org is null or p_provider is null or p_id is null then return false; end if;
  update public.provider_action_reservations set status='released' where organization_id=p_org and provider=p_provider and id=p_id and status='active';
  get diagnostics n = row_count; return n = 1;
end $$;

create or replace function voicepilot_safety.cleanup_action_reservations(p_before timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_before is null or p_before > clock_timestamp() or p_limit is null or p_limit not between 1 and 10000 then return 0; end if;
  with victims as (select ctid from public.provider_action_reservations
    where status in ('released','expired') and expires_at <= p_before
    order by expires_at limit p_limit for update skip locked), removed as (
    delete from public.provider_action_reservations where ctid in (select ctid from victims) returning 1)
  select count(*) into n from removed;
  return n;
end $$;

create or replace function voicepilot_safety.claim_rate(p_org uuid,p_provider text,p_limit integer) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare claimed integer; bucket timestamptz; configured_rate integer;
begin
  if p_org is null or p_provider is null or length(trim(p_provider)) not between 1 and 80 or p_limit is null or p_limit not between 1 and 100000 then return false; end if;
  if not voicepilot_safety.safety_enabled(p_org) then return false; end if;
  select max_per_minute into configured_rate from voicepilot_safety.provider_limits where organization_id=p_org and provider=p_provider for share;
  if configured_rate is null or configured_rate <> p_limit then return false; end if;
  bucket := date_trunc('minute',clock_timestamp());
  insert into voicepilot_safety.provider_rate_windows(organization_id,provider,minute_bucket,hits)
    values(p_org,p_provider,bucket,1) on conflict(organization_id,provider,minute_bucket)
    do update set hits=voicepilot_safety.provider_rate_windows.hits+1 where voicepilot_safety.provider_rate_windows.hits < p_limit
    returning hits into claimed;
  return claimed is not null;
end $$;

create or replace function voicepilot_safety.cleanup_rate_windows(p_before timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare n integer;
begin
  if p_before is null or p_before > date_trunc('minute',clock_timestamp())
    or p_limit is null or p_limit not between 1 and 10000 then return 0; end if;
  with victims as (select ctid from voicepilot_safety.provider_rate_windows
    where minute_bucket < p_before order by minute_bucket limit p_limit for update skip locked), removed as (
    delete from voicepilot_safety.provider_rate_windows where ctid in (select ctid from victims) returning 1)
  select count(*) into n from removed;
  return n;
end $$;

create or replace function voicepilot_safety.set_budget(p_org uuid,p_budget bigint,p_actor uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare prior voicepilot_safety.provider_usage_accounts%rowtype;
begin
  if p_org is null or p_actor is null or voicepilot_safety.current_actor() is distinct from p_actor
    or p_budget is null or p_budget not between 0 and 9007199254740991 or not exists(
    select 1 from public.organization_members where organization_id=p_org and user_id=p_actor and role in ('owner','admin')
  ) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('budget:' || p_org::text,0));
  select * into prior from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if found and prior.used_cents::numeric+prior.reserved_cents > p_budget then return false; end if;
  insert into voicepilot_safety.provider_usage_accounts(organization_id,budget_cents) values(p_org,p_budget)
    on conflict(organization_id) do update set budget_cents=excluded.budget_cents;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,actor_id,detail)
    values(p_org,'budget_set',p_actor,jsonb_build_object('budgetCents',p_budget));
  return true;
end $$;

create or replace function voicepilot_safety.record_usage(p_org uuid,p_key text,p_amount bigint,p_budget bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare acct voicepilot_safety.provider_usage_accounts%rowtype; prior public.provider_usage_ledger%rowtype;
begin
  if p_org is null or p_key is null or length(trim(p_key)) not between 1 and 256
    or p_amount is null or p_amount not between 0 and 9007199254740991 or p_budget is null or p_budget not between 0 and 9007199254740991
    then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into acct from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if not found or acct.budget_cents <> p_budget then return jsonb_build_object('ok',false,'error','unavailable_or_conflict'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into prior from public.provider_usage_ledger where organization_id=p_org and idempotency_key=p_key;
  if found then
    if prior.amount_cents <> p_amount or prior.budget_cents <> p_budget then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'recorded',false,'totalCents',acct.used_cents);
  end if;
  if acct.used_cents::numeric+acct.reserved_cents+p_amount > acct.budget_cents
    then return jsonb_build_object('ok',false,'error','budget_exceeded'); end if;
  insert into public.provider_usage_ledger(organization_id,idempotency_key,amount_cents,budget_cents)
    values(p_org,p_key,p_amount,p_budget);
  update voicepilot_safety.provider_usage_accounts set used_cents=used_cents+p_amount where organization_id=p_org;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) values(p_org,'usage_recorded',jsonb_build_object('key',p_key,'amountCents',p_amount));
  return jsonb_build_object('ok',true,'recorded',true,'totalCents',acct.used_cents+p_amount);
end $$;

create or replace function voicepilot_safety.reserve_usage(p_org uuid,p_key text,p_amount bigint,p_budget bigint,p_expires timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare acct voicepilot_safety.provider_usage_accounts%rowtype; prior voicepilot_safety.provider_usage_reservations%rowtype;
begin
  if p_org is null or p_key is null or length(trim(p_key)) not between 1 and 256
    or p_amount is null or p_amount not between 0 and 9007199254740991 or p_budget is null or p_budget not between 0 and 9007199254740991
    or p_expires is null or p_expires <= clock_timestamp() then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into acct from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if not found or acct.budget_cents <> p_budget then return jsonb_build_object('ok',false,'error','unavailable_or_conflict'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into prior from voicepilot_safety.provider_usage_reservations where organization_id=p_org and idempotency_key=p_key;
  if found then
    if prior.amount_cents <> p_amount or prior.expires_at <> p_expires or prior.status <> 'active' then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'reused',true);
  end if;
  if acct.used_cents::numeric+acct.reserved_cents+p_amount > acct.budget_cents then return jsonb_build_object('ok',false,'error','budget_exceeded'); end if;
  insert into voicepilot_safety.provider_usage_reservations(organization_id,idempotency_key,amount_cents,expires_at) values(p_org,p_key,p_amount,p_expires);
  update voicepilot_safety.provider_usage_accounts set reserved_cents=reserved_cents+p_amount where organization_id=p_org;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) values(p_org,'usage_reserved',jsonb_build_object('key',p_key,'amountCents',p_amount));
  return jsonb_build_object('ok',true,'reused',false);
end $$;

create or replace function voicepilot_safety.settle_usage(p_org uuid,p_key text,p_actual bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog as $$
declare prior voicepilot_safety.provider_usage_reservations%rowtype; acct voicepilot_safety.provider_usage_accounts%rowtype;
begin
  if p_org is null or p_key is null or p_actual is null or p_actual not between 0 and 9007199254740991 then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into acct from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if not found then return jsonb_build_object('ok',false,'error','unavailable'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  select * into prior from voicepilot_safety.provider_usage_reservations where organization_id=p_org and idempotency_key=p_key for update;
  if not found then return jsonb_build_object('ok',false,'error','not_found'); end if;
  if prior.status='settled' then
    if prior.actual_cents <> p_actual then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'recorded',false);
  end if;
  if prior.status <> 'active' or prior.expires_at <= clock_timestamp() or p_actual > prior.amount_cents then return jsonb_build_object('ok',false,'error','invalid'); end if;
  update voicepilot_safety.provider_usage_accounts set reserved_cents=reserved_cents-prior.amount_cents,used_cents=used_cents+p_actual where organization_id=p_org;
  update voicepilot_safety.provider_usage_reservations set status='settled',actual_cents=p_actual where organization_id=p_org and idempotency_key=p_key;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) values(p_org,'usage_settled',jsonb_build_object('key',p_key,'actualCents',p_actual));
  return jsonb_build_object('ok',true,'recorded',true);
end $$;

create or replace function voicepilot_safety.expire_usage(p_org uuid,p_limit integer) returns integer
language plpgsql security definer set search_path = pg_catalog as $$
declare item record; n integer := 0;
begin
  if p_org is null or p_limit is null or p_limit not between 1 and 10000 then return 0; end if;
  perform 1 from voicepilot_safety.provider_usage_accounts where organization_id=p_org for update;
  if not found then return 0; end if;
  for item in select idempotency_key,amount_cents from voicepilot_safety.provider_usage_reservations
      where organization_id=p_org and status='active' and expires_at <= clock_timestamp()
      order by expires_at limit p_limit for update loop
    update voicepilot_safety.provider_usage_reservations set status='expired' where organization_id=p_org and idempotency_key=item.idempotency_key;
    update voicepilot_safety.provider_usage_accounts set reserved_cents=reserved_cents-item.amount_cents where organization_id=p_org;
    n := n+1;
  end loop;
  return n;
end $$;

-- PostgreSQL grants EXECUTE to PUBLIC by default on newly created functions.
revoke all on all functions in schema voicepilot_safety from public, anon, authenticated;
grant execute on all functions in schema voicepilot_safety to service_role;
