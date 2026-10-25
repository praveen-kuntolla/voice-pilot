-- Phase 3.17.1: correct agent approval audit handling after migrations 001-010.
-- Review-only until explicitly approved. This migration changes no rows, policies,
-- triggers, or grants; existing triggers pick up this replacement automatically.

create or replace function public.audit_provider_governance() returns trigger
language plpgsql
security definer
set search_path=pg_catalog, public
as $$
declare
  v_action text;
  v_provider text;
begin
  if tg_op not in ('INSERT', 'UPDATE') then
    raise exception 'unsupported governance audit operation: %', tg_op;
  end if;

  case tg_table_name
    when 'organization_provider_approvals' then
      v_provider := new.provider;
      if tg_op = 'INSERT' then
        v_action := 'approval_granted';
      elsif old.revoked_at is distinct from new.revoked_at then
        v_action := case when new.revoked_at is null then 'approval_granted' else 'approval_revoked' end;
      elsif old.credential_reference is distinct from new.credential_reference then
        v_action := 'credential_reference_changed';
      else
        v_action := 'approval_updated';
      end if;

    when 'agent_provider_approvals' then
      v_provider := new.provider;
      if tg_op = 'INSERT' then
        v_action := 'approval_granted';
      elsif old.revoked_at is distinct from new.revoked_at then
        v_action := case when new.revoked_at is null then 'approval_granted' else 'approval_revoked' end;
      -- The repository upsert refreshes updated_at. Do not create a duplicate
      -- audit event when the active approval's business state and approver match.
      elsif old.organization_id is not distinct from new.organization_id
        and old.agent_id is not distinct from new.agent_id
        and old.provider is not distinct from new.provider
        and old.approved_by is not distinct from new.approved_by then
        return new;
      else
        v_action := 'approval_updated';
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

  insert into public.provider_audit_events(organization_id, actor_id, action, provider, metadata)
  values (new.organization_id, auth.uid(), v_action, v_provider, '{}');
  return new;
end;
$$;

-- Trigger functions are not callable application RPCs. Preserve least privilege.
revoke all on function public.audit_provider_governance() from public, anon, authenticated, service_role;
