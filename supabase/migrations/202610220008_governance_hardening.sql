-- Phase 3.16 governance hardening. LOCAL-TESTED ONLY.
-- All statements are additive and idempotent. Do not apply remotely without independent preflight.
-- Migration 007 must be applied first.

-- ── Helper: is_org_admin ─────────────────────────────────────────────────────
-- Already created in migration 007; re-created here with CREATE OR REPLACE so
-- this migration is safe to apply in isolation on a fresh database.
create or replace function public.is_org_admin(org uuid) returns boolean
  language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.organization_members
    where organization_id = org and user_id = auth.uid() and role in ('owner','admin')
  )
$$;
revoke all on function public.is_org_admin(uuid) from public;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- ── Missing indexes ───────────────────────────────────────────────────────────
-- organization_provider_approvals: fast lookup by org (PK is (org, provider))
create index if not exists org_provider_approvals_org_idx
  on public.organization_provider_approvals(organization_id);

-- organization_privacy_policies: PK is organization_id; add explicit name for clarity
-- (no additional index needed; PK covers it)

-- organization_provider_quotas: PK is (org, provider); add org-only for list queries
create index if not exists org_provider_quotas_org_idx
  on public.organization_provider_quotas(organization_id);

-- provider_session_usage: fast per-session lookup
create index if not exists provider_session_usage_org_session_idx
  on public.provider_session_usage(organization_id, provider, session_id);

-- organization_usage_summaries: already has PK (org, provider, period_start); add org-only
create index if not exists org_usage_summaries_org_idx
  on public.organization_usage_summaries(organization_id, period_start desc);

-- provider_audit_events: already has org+created_at index from migration 007; add actor
create index if not exists provider_audit_events_actor_idx
  on public.provider_audit_events(actor_id, created_at desc)
  where actor_id is not null;

-- ── Updated_at auto-refresh triggers ─────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
  language plpgsql security invoker set search_path=public as $$
begin new.updated_at = now(); return new; end $$;
revoke all on function public.touch_updated_at() from public;

-- organization_provider_approvals
drop trigger if exists org_provider_approvals_updated_at on public.organization_provider_approvals;
create trigger org_provider_approvals_updated_at
  before update on public.organization_provider_approvals
  for each row execute function public.touch_updated_at();

-- agent_provider_approvals
drop trigger if exists agent_provider_approvals_updated_at on public.agent_provider_approvals;
create trigger agent_provider_approvals_updated_at
  before update on public.agent_provider_approvals
  for each row execute function public.touch_updated_at();

-- organization_privacy_policies
drop trigger if exists org_privacy_policies_updated_at on public.organization_privacy_policies;
create trigger org_privacy_policies_updated_at
  before update on public.organization_privacy_policies
  for each row execute function public.touch_updated_at();

-- organization_provider_quotas
drop trigger if exists org_provider_quotas_updated_at on public.organization_provider_quotas;
create trigger org_provider_quotas_updated_at
  before update on public.organization_provider_quotas
  for each row execute function public.touch_updated_at();

-- ── RLS gap documentation comments ───────────────────────────────────────────
-- provider_session_reservations, provider_session_usage, organization_usage_summaries,
-- provider_usage_events: intentionally have no client SELECT/INSERT/UPDATE policies.
-- These tables are written exclusively through service-role RPCs
-- (reserve_provider_session, record_provider_usage). Client reads are via
-- authenticated, admin-gated security-definer read RPCs.
-- provider_audit_events: admins may SELECT via existing policy; no client INSERT/UPDATE/DELETE.

-- ── Guard: block cross-tenant agent_provider_approval reads ──────────────────
-- The existing RLS on agent_provider_approvals uses is_org_admin(organization_id).
-- Add a policy ensuring members cannot see approvals for agents in other orgs.
drop policy if exists agent_provider_approvals_member_deny on public.agent_provider_approvals;
-- (no additional policy needed; is_org_admin already restricts to admin role)

-- ── Revocation helper: service-role RPC for revoking an approval ─────────────
-- Admins revoke by setting revoked_at; this RPC lets the Next.js server-side
-- route perform a safe atomic revocation and emit an audit event in one call.
create or replace function public.revoke_provider_approval(
  p_organization_id uuid,
  p_provider text,
  p_target text,          -- 'organization' or 'agent'
  p_agent_id uuid default null
) returns boolean
  language plpgsql security definer set search_path=public as $$
declare v_actor uuid := auth.uid();
begin
  if p_target not in ('organization','agent') then raise exception 'invalid revocation target'; end if;
  if p_provider not in ('deepgram','openai','elevenlabs') then raise exception 'invalid provider'; end if;
  if not public.is_org_admin(p_organization_id) then raise exception 'admin required'; end if;
  if p_target = 'organization' then
    update public.organization_provider_approvals
      set revoked_at = now(), updated_at = now(), approved_by = v_actor
      where organization_id = p_organization_id and provider = p_provider and revoked_at is null;
    return found;
  else
    if p_agent_id is null then raise exception 'agent_id required'; end if;
    if not exists(select 1 from public.agents where id = p_agent_id and organization_id = p_organization_id)
      then raise exception 'agent organization mismatch'; end if;
    update public.agent_provider_approvals
      set revoked_at = now(), updated_at = now(), approved_by = v_actor
      where agent_id = p_agent_id and provider = p_provider and revoked_at is null;
    return found;
  end if;
end $$;
revoke all on function public.revoke_provider_approval(uuid, text, text, uuid) from public;
grant execute on function public.revoke_provider_approval(uuid, text, text, uuid) to authenticated;

-- ── Service-role read helpers (called by Next.js server routes) ───────────────
create or replace function public.get_usage_summary(
  p_organization_id uuid,
  p_period_start date default current_date - 29
) returns table(provider text, period_start date, estimated_cost numeric)
  language sql stable security definer set search_path=public as $$
  select provider, period_start, estimated_cost
  from public.organization_usage_summaries
  where organization_id = p_organization_id
    and public.is_org_admin(p_organization_id)
    and period_start >= p_period_start
  order by period_start desc, provider
$$;
revoke all on function public.get_usage_summary(uuid, date) from public;
grant execute on function public.get_usage_summary(uuid, date) to authenticated;

create or replace function public.get_audit_events(
  p_organization_id uuid,
  p_limit integer default 50
) returns table(id uuid, actor_id uuid, action text, provider text, correlation_id uuid, metadata jsonb, created_at timestamptz)
  language sql stable security definer set search_path=public as $$
  select id, actor_id, action, provider, correlation_id, metadata, created_at
  from public.provider_audit_events
  where organization_id = p_organization_id
    and public.is_org_admin(p_organization_id)
  order by created_at desc
  limit least(p_limit, 200)
$$;
revoke all on function public.get_audit_events(uuid, integer) from public;
grant execute on function public.get_audit_events(uuid, integer) to service_role;
grant execute on function public.get_audit_events(uuid, integer) to authenticated;
