-- REVIEW-ONLY. Do not apply to established databases.
-- This schema complements, rather than replaces, the durable safety tables in 012-016.
create table if not exists public.voice_session_authorizations(
  authorization_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  session_id uuid not null unique,
  assertion_id uuid not null unique,
  capability text not null check(capability='voice_sandbox'),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check(expires_at>issued_at)
);
create index if not exists voice_session_auth_org_idx on public.voice_session_authorizations(organization_id,expires_at);
create table if not exists public.voice_session_audit_events(
  event_id uuid primary key default gen_random_uuid(), authorization_id uuid not null references public.voice_session_authorizations(authorization_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action text not null check(action in ('authorized','consumed','revoked','released','denied')),
  occurred_at timestamptz not null default now()
);
alter table public.voice_session_authorizations enable row level security;
alter table public.voice_session_audit_events enable row level security;
-- No client policies. Server-side transactional routines must bind actor and tenant context.
revoke all on public.voice_session_authorizations, public.voice_session_audit_events from anon, authenticated;
