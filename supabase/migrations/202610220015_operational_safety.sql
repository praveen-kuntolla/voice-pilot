-- REVIEW ONLY. Apply after 012-014 only in a verified disposable database.
-- No established local or remote database is authorized to receive this migration.
create table if not exists voicepilot_safety.provider_retry_attempts(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  provider text not null check(length(trim(provider)) between 1 and 80),
  idempotency_key text not null check(length(trim(idempotency_key)) between 1 and 256),
  attempt_number integer not null check(attempt_number between 1 and 10),
  attempt_kind text not null check(attempt_kind in ('original','retry')),
  state text not null default 'reserved' check(state in ('reserved','completed','failed','cancelled','expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique(organization_id,idempotency_key),
  unique(organization_id,campaign_id,contact_id,provider,attempt_number)
);
create index if not exists provider_retry_attempts_expiry_idx on voicepilot_safety.provider_retry_attempts(expires_at) where state='reserved';
alter table voicepilot_safety.provider_retry_attempts enable row level security;
revoke all on voicepilot_safety.provider_retry_attempts from public,anon,authenticated;
grant select on voicepilot_safety.provider_retry_attempts to service_role;

create table if not exists voicepilot_safety.gateway_audit_events(
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  correlation_id text not null check(length(trim(correlation_id)) between 1 and 128),
  event_type text not null check(length(trim(event_type)) between 1 and 64),
  reason text not null check(length(trim(reason)) between 1 and 160),
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);
create unique index if not exists gateway_audit_identity_idx on voicepilot_safety.gateway_audit_events(coalesce(organization_id,'00000000-0000-0000-0000-000000000000'::uuid),correlation_id,event_type,reason);
alter table voicepilot_safety.gateway_audit_events enable row level security;
revoke all on voicepilot_safety.gateway_audit_events from public,anon,authenticated;
grant select on voicepilot_safety.gateway_audit_events to service_role;

create or replace function voicepilot_safety.reserve_retry_attempt(
  p_org uuid,p_campaign uuid,p_contact uuid,p_agent uuid,p_provider text,p_key text,p_kind text,p_max integer,p_expires timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare prior voicepilot_safety.provider_retry_attempts%rowtype; n integer; new_id uuid;
begin
  if p_org is null or p_campaign is null or p_contact is null or p_agent is null or p_provider is null or length(trim(p_provider)) not between 1 and 80
    or p_key is null or length(trim(p_key)) not between 1 and 256 or p_kind not in ('original','retry') or p_max not between 1 and 10
    or p_expires is null or p_expires <= clock_timestamp() then return jsonb_build_object('ok',false,'error','invalid'); end if;
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  perform pg_advisory_xact_lock(hashtextextended('retry:'||p_org::text||':'||p_campaign::text||':'||p_contact::text||':'||p_provider,0));
  if not voicepilot_safety.safety_enabled(p_org) then return jsonb_build_object('ok',false,'error','unavailable_or_stopped'); end if;
  if not exists(select 1 from voicepilot_safety.provider_action_policies where organization_id=p_org and campaign_id=p_campaign and agent_id=p_agent and provider=p_provider and enabled=true and max_attempts=p_max)
    or not exists(select 1 from public.contacts where id=p_contact and organization_id=p_org and consent_status='granted' and opted_out_at is null)
    then return jsonb_build_object('ok',false,'error','policy_changed'); end if;
  select * into prior from voicepilot_safety.provider_retry_attempts where organization_id=p_org and idempotency_key=p_key;
  if found then
    if prior.campaign_id<>p_campaign or prior.contact_id<>p_contact or prior.agent_id<>p_agent or prior.provider<>p_provider or prior.attempt_kind<>p_kind or prior.expires_at<>p_expires
      then return jsonb_build_object('ok',false,'error','conflict'); end if;
    return jsonb_build_object('ok',true,'attemptId',prior.id,'attemptNumber',prior.attempt_number,'reused',true);
  end if;
  select count(*) into n from voicepilot_safety.provider_retry_attempts where organization_id=p_org and campaign_id=p_campaign and contact_id=p_contact and provider=p_provider;
  if (n=0 and p_kind<>'original') or (n>0 and p_kind<>'retry') then return jsonb_build_object('ok',false,'error','conflict'); end if;
  if n >= p_max then return jsonb_build_object('ok',false,'error','retry_limit'); end if;
  insert into voicepilot_safety.provider_retry_attempts(organization_id,campaign_id,contact_id,agent_id,provider,idempotency_key,attempt_number,attempt_kind,expires_at)
    values(p_org,p_campaign,p_contact,p_agent,p_provider,p_key,n+1,p_kind,p_expires) returning id into new_id;
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) values(p_org,'retry_attempt_reserved',jsonb_build_object('attemptId',new_id,'attemptNumber',n+1,'kind',p_kind));
  return jsonb_build_object('ok',true,'attemptId',new_id,'attemptNumber',n+1,'reused',false);
end $$;

create or replace function voicepilot_safety.finish_retry_attempt(p_org uuid,p_id uuid,p_state text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
  if p_org is null or p_id is null or p_state not in ('completed','failed','cancelled') then return false; end if;
  update voicepilot_safety.provider_retry_attempts set state=p_state,finished_at=clock_timestamp() where organization_id=p_org and id=p_id and state='reserved';
  get diagnostics n=row_count;
  if n=1 then insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) values(p_org,'retry_attempt_finished',jsonb_build_object('attemptId',p_id,'state',p_state)); end if;
  return n=1;
end $$;

create or replace function voicepilot_safety.reconcile_retry_attempts(p_before timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
  if p_before is null or p_before>clock_timestamp() or p_limit not between 1 and 1000 then return 0; end if;
  with victims as (select id from voicepilot_safety.provider_retry_attempts where state='reserved' and expires_at<=p_before order by expires_at limit p_limit for update skip locked), changed as (
    update voicepilot_safety.provider_retry_attempts set state='expired',finished_at=clock_timestamp() where id in(select id from victims) returning organization_id,id)
  insert into voicepilot_safety.provider_safety_audit(organization_id,action,detail) select organization_id,'retry_attempt_expired',jsonb_build_object('attemptId',id) from changed;
  get diagnostics n=row_count; return n;
end $$;

create or replace function voicepilot_safety.cleanup_retry_attempts(p_before timestamptz,p_limit integer) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
  if p_before is null or p_before>clock_timestamp() or p_limit not between 1 and 1000 then return 0; end if;
  with victims as (select id from voicepilot_safety.provider_retry_attempts where state in('failed','cancelled','expired') and finished_at<=p_before order by finished_at limit p_limit for update skip locked), removed as (
    delete from voicepilot_safety.provider_retry_attempts where id in(select id from victims) returning 1)
  select count(*) into n from removed; return n;
end $$;

create or replace function voicepilot_safety.record_gateway_event(p_org uuid,p_correlation text,p_type text,p_reason text,p_occurred timestamptz) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if p_correlation is null or length(trim(p_correlation)) not between 1 and 128 or p_type is null or length(trim(p_type)) not between 1 and 64
    or p_reason is null or length(trim(p_reason)) not between 1 and 160 or p_occurred is null then return false; end if;
  if p_org is not null and nullif(current_setting('voicepilot.organization_id',true),'') is distinct from p_org::text then return false; end if;
  insert into voicepilot_safety.gateway_audit_events(organization_id,correlation_id,event_type,reason,occurred_at)
    values(p_org,p_correlation,p_type,p_reason,p_occurred) on conflict do nothing;
  return true;
end $$;

create or replace function voicepilot_safety.reject_gateway_audit_mutation() returns trigger language plpgsql set search_path=pg_catalog as $$ begin raise exception 'gateway audit events are immutable'; end $$;
drop trigger if exists gateway_audit_immutable on voicepilot_safety.gateway_audit_events;
create trigger gateway_audit_immutable before update or delete on voicepilot_safety.gateway_audit_events for each row execute function voicepilot_safety.reject_gateway_audit_mutation();

revoke all on all functions in schema voicepilot_safety from public,anon,authenticated;
grant execute on all functions in schema voicepilot_safety to service_role;
