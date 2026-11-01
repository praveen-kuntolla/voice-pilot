-- REVIEW-ONLY. Apply only to a verified disposable acceptance database.
-- Provides the server-side transactional boundary for migration 017.
alter table public.voice_session_authorizations
  add column if not exists released_at timestamptz,
  add column if not exists usage_reserved_seconds integer not null default 0;

create or replace function public.create_voice_session_authorization(
  p_authorization_id uuid, p_organization_id uuid, p_agent_id uuid,
  p_actor_id uuid, p_session_id uuid, p_assertion_id uuid,
  p_issued_at timestamptz, p_expires_at timestamptz
) returns public.voice_session_authorizations
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.voice_session_authorizations;
begin
  if p_organization_id is null or p_agent_id is null or p_actor_id is null
     or p_session_id is null or p_assertion_id is null
     or p_expires_at <= p_issued_at
     or nullif(current_setting('request.jwt.claim.sub', true), '')::uuid is distinct from p_actor_id
     or not exists (select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_actor_id and m.role in ('owner','admin','member'))
     or not exists (select 1 from public.agents a where a.id=p_agent_id and a.organization_id=p_organization_id) then
    raise exception 'voice_session_authorization_denied';
  end if;
  insert into public.voice_session_authorizations(authorization_id,organization_id,agent_id,actor_id,session_id,assertion_id,capability,issued_at,expires_at)
    values(p_authorization_id,p_organization_id,p_agent_id,p_actor_id,p_session_id,p_assertion_id,'voice_sandbox',p_issued_at,p_expires_at)
    returning * into v;
  insert into public.voice_session_audit_events(authorization_id,organization_id,action)
    values(v.authorization_id,v.organization_id,'authorized');
  return v;
exception when unique_violation then
  raise exception 'voice_session_authorization_duplicate';
end;
$$;

create or replace function public.consume_voice_session_authorization(
  p_assertion_id uuid, p_organization_id uuid, p_actor_id uuid,
  p_now timestamptz default clock_timestamp(), p_max_concurrent integer default 1,
  p_usage_limit_seconds integer default 3600
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, auth
as $$
declare v public.voice_session_authorizations; v_active integer; v_usage integer;
begin
  if p_assertion_id is null or p_organization_id is null or p_actor_id is null
     or p_max_concurrent is null or p_max_concurrent < 1 or p_max_concurrent > 100
     or p_usage_limit_seconds is null or p_usage_limit_seconds < 1 or p_usage_limit_seconds > 86400
     or nullif(current_setting('request.jwt.claim.sub', true), '')::uuid is distinct from p_actor_id
     or nullif(current_setting('voicepilot.organization_id', true), '')::uuid is distinct from p_organization_id then
    return jsonb_build_object('ok',false,'error','unauthorized');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));
  select * into v from public.voice_session_authorizations where assertion_id=p_assertion_id for update;
  if not found or v.organization_id <> p_organization_id or v.actor_id <> p_actor_id then return jsonb_build_object('ok',false,'error','tenant_mismatch'); end if;
  if v.revoked_at is not null then return jsonb_build_object('ok',false,'error','revoked'); end if;
  if v.expires_at <= p_now then return jsonb_build_object('ok',false,'error','expired'); end if;
  if v.consumed_at is not null and v.released_at is null then return jsonb_build_object('ok',true,'reused',true,'sessionId',v.session_id); end if;
  if v.consumed_at is not null then return jsonb_build_object('ok',false,'error','replayed'); end if;
  if exists(select 1 from public.provider_safety_controls s where s.organization_id=p_organization_id and s.emergency_stop)
     or exists(select 1 from voicepilot_safety.provider_global_stop where singleton and emergency_stop) then return jsonb_build_object('ok',false,'error','emergency_stop'); end if;
  select count(*)::integer, coalesce(sum(usage_reserved_seconds),0)::integer into v_active,v_usage from public.voice_session_authorizations where organization_id=p_organization_id and consumed_at is not null and released_at is null;
  if v_active >= p_max_concurrent then return jsonb_build_object('ok',false,'error','concurrency_unavailable'); end if;
  if v_usage + extract(epoch from (v.expires_at-v.issued_at))::integer > p_usage_limit_seconds then return jsonb_build_object('ok',false,'error','usage_unavailable'); end if;
  update public.voice_session_authorizations set consumed_at=p_now, usage_reserved_seconds=extract(epoch from (expires_at-issued_at))::integer where authorization_id=v.authorization_id;
  insert into public.voice_session_audit_events(authorization_id,organization_id,action) values(v.authorization_id,v.organization_id,'consumed');
  return jsonb_build_object('ok',true,'reused',false,'sessionId',v.session_id);
end;
$$;

create or replace function public.revoke_voice_session_authorization(p_assertion_id uuid,p_organization_id uuid,p_actor_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
  if nullif(current_setting('request.jwt.claim.sub',true),'')::uuid is distinct from p_actor_id or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_organization_id then return false; end if;
  update public.voice_session_authorizations set revoked_at=clock_timestamp() where assertion_id=p_assertion_id and organization_id=p_organization_id and actor_id=p_actor_id and revoked_at is null;
  if not found then return false; end if;
  insert into public.voice_session_audit_events(authorization_id,organization_id,action) select authorization_id,organization_id,'revoked' from public.voice_session_authorizations where assertion_id=p_assertion_id and organization_id=p_organization_id;
  return true;
end; $$;

create or replace function public.release_voice_session_authorization(p_session_id uuid,p_organization_id uuid,p_actor_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v public.voice_session_authorizations;
begin
  if nullif(current_setting('request.jwt.claim.sub',true),'')::uuid is distinct from p_actor_id or nullif(current_setting('voicepilot.organization_id',true),'')::uuid is distinct from p_organization_id then return false; end if;
  update public.voice_session_authorizations set released_at=clock_timestamp() where session_id=p_session_id and organization_id=p_organization_id and actor_id=p_actor_id and released_at is null returning * into v;
  if not found then return false; end if;
  insert into public.voice_session_audit_events(authorization_id,organization_id,action) values(v.authorization_id,v.organization_id,'released');
  return true;
end; $$;

revoke all on function public.create_voice_session_authorization(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.consume_voice_session_authorization(uuid,uuid,uuid,timestamptz,integer,integer) from public, anon, authenticated;
revoke all on function public.revoke_voice_session_authorization(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.release_voice_session_authorization(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_voice_session_authorization(uuid,uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz), public.consume_voice_session_authorization(uuid,uuid,uuid,timestamptz,integer,integer), public.revoke_voice_session_authorization(uuid,uuid,uuid), public.release_voice_session_authorization(uuid,uuid,uuid) to service_role;
