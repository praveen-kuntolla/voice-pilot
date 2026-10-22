-- LOCAL-TESTED ONLY. Do not apply remotely without independent preflight and approval.
-- Provider credential references are opaque identifiers, never credential material.

create or replace function public.is_org_admin(org uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid() and role in ('owner','admin'))
$$;
revoke all on function public.is_org_admin(uuid) from public;
grant execute on function public.is_org_admin(uuid) to authenticated;

create table public.organization_provider_approvals(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  credential_reference text not null check(length(credential_reference) between 3 and 256),
  approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(), revoked_at timestamptz,
  updated_at timestamptz not null default now(), primary key(organization_id,provider)
);
create table public.agent_provider_approvals(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  approved_by uuid not null references auth.users(id), approved_at timestamptz not null default now(), revoked_at timestamptz,
  updated_at timestamptz not null default now(), primary key(agent_id,provider)
);
create table public.organization_privacy_policies(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  audio_retention_days smallint not null default 0 check(audio_retention_days between 0 and 365),
  transcript_retention_days smallint not null default 30 check(transcript_retention_days between 0 and 365),
  consent_required boolean not null default true,
  permitted_regions text[] not null default '{}', redact_diagnostics boolean not null default true,
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.organization_provider_quotas(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  max_session_estimated_cost numeric(14,6) not null default 0 check(max_session_estimated_cost >= 0),
  max_organization_estimated_cost numeric(14,6) not null default 0 check(max_organization_estimated_cost >= 0),
  max_concurrent_sessions integer not null default 0 check(max_concurrent_sessions >= 0),
  updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), primary key(organization_id,provider)
);
create table public.provider_session_reservations(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  session_id uuid not null, expires_at timestamptz not null, created_at timestamptz not null default now(), primary key(organization_id,provider,session_id)
);
create table public.provider_session_usage(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  session_id uuid not null, estimated_cost numeric(14,6) not null default 0 check(estimated_cost >= 0),
  updated_at timestamptz not null default now(), primary key(organization_id,provider,session_id)
);
create table public.organization_usage_summaries(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  period_start date not null default current_date, estimated_cost numeric(14,6) not null default 0 check(estimated_cost >= 0),
  updated_at timestamptz not null default now(), primary key(organization_id,provider,period_start)
);
create table public.provider_usage_events(
  event_id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade, provider text not null check(provider in ('deepgram','openai','elevenlabs')),
  session_id uuid not null, metric text not null check(metric in ('stt_seconds','llm_input_tokens','llm_output_tokens','tts_characters')),
  quantity numeric(18,4) not null check(quantity >= 0), estimated_cost numeric(14,6) not null check(estimated_cost >= 0), occurred_at timestamptz not null default now()
);
create table public.provider_audit_events(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id), action text not null check(action in ('approval_granted','approval_revoked','privacy_policy_changed','provider_configuration_changed','quota_changed','session_rejected','budget_exceeded','credential_reference_changed')),
  provider text check(provider is null or provider in ('deepgram','openai','elevenlabs')), correlation_id uuid, metadata jsonb not null default '{}' check(not (metadata ? 'credential') and not (metadata ? 'transcript') and not (metadata ? 'audio')), created_at timestamptz not null default now()
);
create index agent_provider_approvals_org_idx on public.agent_provider_approvals(organization_id,agent_id);
create index provider_reservations_expiry_idx on public.provider_session_reservations(expires_at);
create index provider_usage_events_org_idx on public.provider_usage_events(organization_id,provider,occurred_at desc);
create index provider_audit_events_org_idx on public.provider_audit_events(organization_id,created_at desc);

create or replace function public.validate_provider_governance_agent() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if not exists(select 1 from public.agents where id=new.agent_id and organization_id=new.organization_id) then raise exception 'provider governance agent must belong to organization'; end if;
 return new;
end $$;
create trigger agent_provider_approval_org_match before insert or update of organization_id,agent_id on public.agent_provider_approvals for each row execute function public.validate_provider_governance_agent();
create trigger reservation_agent_org_match before insert or update of organization_id,agent_id on public.provider_session_reservations for each row execute function public.validate_provider_governance_agent();
create trigger session_usage_agent_org_match before insert or update of organization_id,agent_id on public.provider_session_usage for each row execute function public.validate_provider_governance_agent();
create trigger usage_event_agent_org_match before insert or update of organization_id,agent_id on public.provider_usage_events for each row execute function public.validate_provider_governance_agent();
revoke all on function public.validate_provider_governance_agent() from public;

alter table public.organization_provider_approvals enable row level security;
alter table public.agent_provider_approvals enable row level security;
alter table public.organization_privacy_policies enable row level security;
alter table public.organization_provider_quotas enable row level security;
alter table public.provider_session_reservations enable row level security;
alter table public.provider_session_usage enable row level security;
alter table public.organization_usage_summaries enable row level security;
alter table public.provider_usage_events enable row level security;
alter table public.provider_audit_events enable row level security;

create policy provider_approvals_admin_select on public.organization_provider_approvals for select using(public.is_org_admin(organization_id));
create policy provider_approvals_admin_insert on public.organization_provider_approvals for insert with check(public.is_org_admin(organization_id) and approved_by=auth.uid());
create policy provider_approvals_admin_update on public.organization_provider_approvals for update using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id) and approved_by=auth.uid());
create policy agent_provider_approvals_admin_select on public.agent_provider_approvals for select using(public.is_org_admin(organization_id));
create policy agent_provider_approvals_admin_insert on public.agent_provider_approvals for insert with check(public.is_org_admin(organization_id) and approved_by=auth.uid());
create policy agent_provider_approvals_admin_update on public.agent_provider_approvals for update using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id) and approved_by=auth.uid());
create policy privacy_policy_admin_select on public.organization_privacy_policies for select using(public.is_org_admin(organization_id));
create policy privacy_policy_admin_insert on public.organization_privacy_policies for insert with check(public.is_org_admin(organization_id) and updated_by=auth.uid());
create policy privacy_policy_admin_update on public.organization_privacy_policies for update using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id) and updated_by=auth.uid());
create policy quotas_admin_select on public.organization_provider_quotas for select using(public.is_org_admin(organization_id));
create policy quotas_admin_insert on public.organization_provider_quotas for insert with check(public.is_org_admin(organization_id) and updated_by=auth.uid());
create policy quotas_admin_update on public.organization_provider_quotas for update using(public.is_org_admin(organization_id)) with check(public.is_org_admin(organization_id) and updated_by=auth.uid());
create policy provider_audit_admin_select on public.provider_audit_events for select using(public.is_org_admin(organization_id));
-- No client policies for usage/reservation/summary/audit writes: internal RPC only.

create or replace function public.audit_provider_governance() returns trigger language plpgsql security definer set search_path=public as $$
declare v_action text;
begin
 v_action := case tg_table_name
  when 'organization_provider_approvals' then case when tg_op='UPDATE' and new.revoked_at is not null then 'approval_revoked' else 'approval_granted' end
  when 'agent_provider_approvals' then case when tg_op='UPDATE' and new.revoked_at is not null then 'approval_revoked' else 'approval_granted' end
  when 'organization_privacy_policies' then 'privacy_policy_changed'
  when 'organization_provider_quotas' then 'quota_changed' end;
 insert into public.provider_audit_events(organization_id,actor_id,action,provider,metadata) values(new.organization_id,auth.uid(),v_action,case when tg_table_name in ('organization_provider_approvals','agent_provider_approvals','organization_provider_quotas') then new.provider else null end,'{}');
 return new;
end $$;
create trigger provider_approval_audit after insert or update on public.organization_provider_approvals for each row execute function public.audit_provider_governance();
create trigger agent_provider_approval_audit after insert or update on public.agent_provider_approvals for each row execute function public.audit_provider_governance();
create trigger privacy_policy_audit after insert or update on public.organization_privacy_policies for each row execute function public.audit_provider_governance();
create trigger provider_quota_audit after insert or update on public.organization_provider_quotas for each row execute function public.audit_provider_governance();
revoke all on function public.audit_provider_governance() from public;

create or replace function public.reserve_provider_session(p_organization_id uuid,p_agent_id uuid,p_provider text,p_session_id uuid,p_expires_at timestamptz) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_limit integer; v_count integer;
begin
 if p_provider not in ('deepgram','openai','elevenlabs') or p_expires_at <= now() then raise exception 'invalid provider reservation'; end if;
 if not exists(select 1 from public.agents where id=p_agent_id and organization_id=p_organization_id) then raise exception 'agent organization mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_provider,0));
 delete from public.provider_session_reservations where organization_id=p_organization_id and provider=p_provider and expires_at <= now();
 select max_concurrent_sessions into v_limit from public.organization_provider_quotas where organization_id=p_organization_id and provider=p_provider;
 if v_limit is null then raise exception 'provider quota unavailable'; end if;
 if exists(select 1 from public.provider_session_reservations where organization_id=p_organization_id and provider=p_provider and session_id=p_session_id) then return true; end if;
 select count(*) into v_count from public.provider_session_reservations where organization_id=p_organization_id and provider=p_provider;
 if v_limit > 0 and v_count >= v_limit then return false; end if;
 insert into public.provider_session_reservations(organization_id,agent_id,provider,session_id,expires_at) values(p_organization_id,p_agent_id,p_provider,p_session_id,p_expires_at);
 return true;
end $$;

create or replace function public.record_provider_usage(p_event_id uuid,p_organization_id uuid,p_agent_id uuid,p_provider text,p_session_id uuid,p_metric text,p_quantity numeric,p_estimated_cost numeric) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_session_limit numeric; v_org_limit numeric; v_session_cost numeric; v_org_cost numeric;
begin
 if p_metric not in ('stt_seconds','llm_input_tokens','llm_output_tokens','tts_characters') or p_quantity < 0 or p_estimated_cost < 0 then raise exception 'invalid usage event'; end if;
 if not exists(select 1 from public.agents where id=p_agent_id and organization_id=p_organization_id) then raise exception 'agent organization mismatch'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_provider,0));
 if exists(select 1 from public.provider_usage_events where event_id=p_event_id) then return false; end if;
 select max_session_estimated_cost,max_organization_estimated_cost into v_session_limit,v_org_limit from public.organization_provider_quotas where organization_id=p_organization_id and provider=p_provider;
 if v_session_limit is null then raise exception 'provider quota unavailable'; end if;
 select estimated_cost into v_session_cost from public.provider_session_usage where organization_id=p_organization_id and provider=p_provider and session_id=p_session_id for update;
 select estimated_cost into v_org_cost from public.organization_usage_summaries where organization_id=p_organization_id and provider=p_provider and period_start=current_date for update;
 if v_session_limit > 0 and coalesce(v_session_cost,0)+p_estimated_cost > v_session_limit then raise exception 'session budget exceeded'; end if;
 if v_org_limit > 0 and coalesce(v_org_cost,0)+p_estimated_cost > v_org_limit then raise exception 'organization budget exceeded'; end if;
 insert into public.provider_usage_events(event_id,organization_id,agent_id,provider,session_id,metric,quantity,estimated_cost) values(p_event_id,p_organization_id,p_agent_id,p_provider,p_session_id,p_metric,p_quantity,p_estimated_cost);
 insert into public.provider_session_usage(organization_id,agent_id,provider,session_id,estimated_cost) values(p_organization_id,p_agent_id,p_provider,p_session_id,p_estimated_cost) on conflict(organization_id,provider,session_id) do update set estimated_cost=provider_session_usage.estimated_cost+excluded.estimated_cost,updated_at=now();
 insert into public.organization_usage_summaries(organization_id,provider,period_start,estimated_cost) values(p_organization_id,p_provider,current_date,p_estimated_cost) on conflict(organization_id,provider,period_start) do update set estimated_cost=organization_usage_summaries.estimated_cost+excluded.estimated_cost,updated_at=now();
 return true;
end $$;
revoke all on function public.reserve_provider_session(uuid,uuid,text,uuid,timestamptz) from public;
revoke all on function public.record_provider_usage(uuid,uuid,uuid,text,uuid,text,numeric,numeric) from public;
grant execute on function public.reserve_provider_session(uuid,uuid,text,uuid,timestamptz) to service_role;
grant execute on function public.record_provider_usage(uuid,uuid,uuid,text,uuid,text,numeric,numeric) to service_role;
