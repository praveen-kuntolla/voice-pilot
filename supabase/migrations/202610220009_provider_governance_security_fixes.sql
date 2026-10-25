-- Phase 3.16 local security repair. Apply only after migrations 001-008.
-- Fixes the governance audit trigger and explicitly removes default execute
-- grants inherited by Supabase runtime roles.

create or replace function public.audit_provider_governance() returns trigger
language plpgsql security definer set search_path=pg_catalog, public as $$
declare
  v_action text;
  v_provider text;
begin
  case tg_table_name
    when 'organization_provider_approvals', 'agent_provider_approvals' then
      v_provider := new.provider;
      if tg_op = 'UPDATE' and old.revoked_at is distinct from new.revoked_at and new.revoked_at is not null then
        v_action := 'approval_revoked';
      elsif tg_op = 'UPDATE' then
        v_action := 'approval_updated';
      else
        v_action := 'approval_granted';
      end if;
    when 'organization_privacy_policies' then
      v_action := 'privacy_policy_changed';
      v_provider := null;
    when 'organization_provider_quotas' then
      v_action := 'quota_changed';
      v_provider := new.provider;
    else
      raise exception 'unsupported governance audit target: %', tg_table_name;
  end case;

  insert into public.provider_audit_events(organization_id,actor_id,action,provider,metadata)
  values(new.organization_id,auth.uid(),v_action,v_provider,'{}');
  return new;
end $$;
revoke all on function public.audit_provider_governance() from public, anon, authenticated, service_role;

-- Internal accounting remains callable only by the server-side service role.
revoke all on function public.reserve_provider_session(uuid,uuid,text,uuid,timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.reserve_provider_session(uuid,uuid,text,uuid,timestamptz) to service_role;
revoke all on function public.record_provider_usage(uuid,uuid,uuid,text,uuid,text,numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function public.record_provider_usage(uuid,uuid,uuid,text,uuid,text,numeric,numeric) to service_role;

-- Invitation acceptance is an authenticated end-user workflow; no other
-- runtime role needs direct RPC access.
revoke all on function public.accept_organization_invitation(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_organization_invitation(text) to authenticated;

-- This function is trigger-only. Trigger execution does not require caller
-- EXECUTE privileges, so all direct runtime invocation is removed.
revoke all on function public.validate_campaign_agent_organization() from public, anon, authenticated, service_role;
