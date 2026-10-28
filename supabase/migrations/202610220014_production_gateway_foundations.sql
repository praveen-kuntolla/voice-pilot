-- REVIEW ONLY. Apply only after migrations 012-013 in a verified disposable database.
-- No established local or remote database is authorized to receive this migration.
create table if not exists voicepilot_safety.provider_action_policies(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  provider text not null check(length(trim(provider)) between 1 and 80),
  max_attempts integer not null check(max_attempts between 1 and 10),
  estimated_action_cents bigint not null check(estimated_action_cents between 0 and 9007199254740991),
  enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,campaign_id)
);
alter table voicepilot_safety.provider_action_policies enable row level security;
revoke all on voicepilot_safety.provider_action_policies from public,anon,authenticated;
grant usage on schema public to service_role;
grant select on voicepilot_safety.provider_action_policies,voicepilot_safety.provider_limits,
  voicepilot_safety.provider_usage_accounts to service_role;
grant select on public.organization_members,public.campaigns,public.agents,public.contacts,
  public.organization_provider_approvals,public.agent_provider_approvals,
  public.organization_provider_quotas,public.provider_action_reservations to service_role;
