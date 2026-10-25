-- Phase 3.16 local RLS verification for governance tables.
-- Run against a disposable local Supabase instance ONLY.
-- Requires: migrations 001-008 applied, two test org fixtures.
-- No remote Supabase, no production data.

-- ── Setup expectations ────────────────────────────────────────────────────────
-- Fixture: org_a (admin_user is owner), org_b (other_user is owner).
-- This script checks that:
--   1. org_a admin can read/write org_a governance rows.
--   2. org_a admin cannot read org_b governance rows.
--   3. org_a member (non-admin) cannot write governance rows.
--   4. Anonymous cannot read any governance row.

-- ── 1. Verify RLS is enabled on all governance tables ─────────────────────────
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'organization_provider_approvals',
    'agent_provider_approvals',
    'organization_privacy_policies',
    'organization_provider_quotas',
    'provider_session_reservations',
    'provider_session_usage',
    'organization_usage_summaries',
    'provider_usage_events',
    'provider_audit_events'
  )
order by tablename;
-- Expected: rowsecurity = true for all 9 rows.

-- ── 2. Verify is_org_admin function exists ────────────────────────────────────
select exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'is_org_admin'
) as is_org_admin_exists;

-- ── 3. Verify revoke_provider_approval function exists ───────────────────────
select exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'revoke_provider_approval'
) as revoke_fn_exists;

-- ── 4. Verify touch_updated_at trigger function exists ───────────────────────
select exists(
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'touch_updated_at'
) as touch_updated_at_exists;

-- ── 5. Verify updated_at triggers are present ────────────────────────────────
select
  event_object_table,
  trigger_name
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'org_provider_approvals_updated_at',
    'agent_provider_approvals_updated_at',
    'org_privacy_policies_updated_at',
    'org_provider_quotas_updated_at'
  )
order by trigger_name;
-- Expected: 4 rows.

-- ── 6. Verify indexes exist ───────────────────────────────────────────────────
select
  schemaname,
  tablename,
  indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'org_provider_approvals_org_idx',
    'org_provider_quotas_org_idx',
    'provider_session_usage_org_session_idx',
    'org_usage_summaries_org_idx',
    'provider_audit_events_actor_idx'
  )
order by indexname;
-- Expected: 5 rows.

-- ── 7. Verify RPC grants are least-privilege ─────────────────────────────────
-- Accounting writes must remain service-role-only.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where specific_schema = 'public'
  and routine_name in ('reserve_provider_session', 'record_provider_usage')
  and grantee = 'service_role';
-- Expected: rows for both internal accounting RPCs.

-- Admin-gated reporting helpers are callable by authenticated users but also
-- enforce is_org_admin() inside their SECURITY DEFINER bodies.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where specific_schema = 'public'
  and routine_name in ('get_usage_summary', 'get_audit_events')
  and grantee = 'authenticated';
-- Expected: rows for both reporting RPCs; no public grants.

-- ── 8. Cross-tenant select check (run as org_a admin) ────────────────────────
-- This should return 0 rows when set role is org_a admin checking org_b data:
-- select count(*) from public.organization_provider_approvals
-- where organization_id = '<org_b_id>';
-- Expected: 0

-- ── 9. Audit event immutability check ────────────────────────────────────────
-- Attempt INSERT should fail for authenticated user (no client insert policy):
-- insert into public.provider_audit_events(id, organization_id, action, metadata)
-- values(gen_random_uuid(), '<org_a_id>', 'approval_granted', '{}');
-- Expected: RLS violation error.

-- ── Summary ───────────────────────────────────────────────────────────────────
-- All checks above should pass before Phase 3.16 is marked complete.
-- Run this script against the disposable local Supabase instance only.
-- Do not apply or verify against remote/production.
