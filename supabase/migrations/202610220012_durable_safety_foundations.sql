-- REVIEW-ONLY DESIGN. Not applied by this change.
-- Production use requires transactional RPCs, distributed rate limiting,
-- retention/cleanup, observability and an independently tested rollback.
create table if not exists public.provider_replay_claims(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check(length(trim(provider)) between 1 and 80),
  event_id text not null check(length(trim(event_id)) between 1 and 256),
  expires_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  primary key(organization_id, provider, event_id)
);
create index if not exists provider_replay_claims_expiry_idx on public.provider_replay_claims(expires_at);
create table if not exists public.provider_safety_controls(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  emergency_stop boolean not null default false,
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create table if not exists public.provider_action_reservations(
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null, idempotency_key text not null, expires_at timestamptz not null, created_at timestamptz not null default now(),
  unique(organization_id, provider, idempotency_key)
);
create index if not exists provider_action_reservations_active_idx on public.provider_action_reservations(organization_id, provider, expires_at);
create table if not exists public.provider_usage_ledger(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null, amount_cents bigint not null check(amount_cents >= 0), occurred_at timestamptz not null default now(),
  primary key(organization_id, idempotency_key)
);
create index if not exists provider_usage_ledger_org_time_idx on public.provider_usage_ledger(organization_id, occurred_at desc);
alter table public.provider_replay_claims enable row level security;
alter table public.provider_safety_controls enable row level security;
alter table public.provider_action_reservations enable row level security;
alter table public.provider_usage_ledger enable row level security;
-- No client policies: replay, reservations and usage writes belong to
-- transaction-scoped internal RPCs. Control writes require a separately
-- reviewed admin RPC; do not expose these tables directly to clients.
