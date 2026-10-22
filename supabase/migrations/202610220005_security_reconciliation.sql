-- REVIEW-ONLY SECURITY RECONCILIATION. Do not apply without explicit approval.
-- This migration is additive/data-preserving except for replacing RLS policies.

-- Reconcile schema fields that may be absent in a partially applied 003.
alter table public.contacts add column if not exists consent_status text not null default 'unknown' check(consent_status in ('unknown','granted','revoked'));
alter table public.contacts add column if not exists opted_out_at timestamptz;
alter table public.contacts add column if not exists updated_at timestamptz not null default now();
alter table public.campaigns add column if not exists timezone text not null default 'UTC';
alter table public.campaigns add column if not exists start_hour smallint not null default 9 check(start_hour between 0 and 23);
alter table public.campaigns add column if not exists end_hour smallint not null default 17 check(end_hour between 1 and 24 and end_hour>start_hour);
alter table public.campaigns add column if not exists consent_required boolean not null default true;

-- Prevent a campaign from assigning an agent owned by another organization.
create or replace function public.validate_campaign_agent_organization() returns trigger
language plpgsql security invoker set search_path=public as $$
begin
  if new.agent_id is not null and not exists (
    select 1 from public.agents a where a.id=new.agent_id and a.organization_id=new.organization_id
  ) then raise exception 'campaign agent must belong to the same organization'; end if;
  return new;
end; $$;
drop trigger if exists campaigns_agent_same_org on public.campaigns;
create trigger campaigns_agent_same_org before insert or update of organization_id,agent_id on public.campaigns
for each row execute function public.validate_campaign_agent_organization();
revoke all on function public.validate_campaign_agent_organization() from public;

-- Remove known legacy/broad policy names from earlier variants. IF EXISTS is intentional.
drop policy if exists "org members read agents" on public.agents; drop policy if exists "org admins write agents" on public.agents;
drop policy if exists "org members read sources" on public.knowledge_sources; drop policy if exists "org admins write sources" on public.knowledge_sources;
drop policy if exists "org members read contacts" on public.contacts; drop policy if exists "org admins write contacts" on public.contacts;
drop policy if exists "org members read campaigns" on public.campaigns; drop policy if exists "org admins write campaigns" on public.campaigns;
drop policy if exists "agents_select_member" on public.agents; drop policy if exists "agents_insert_admin" on public.agents; drop policy if exists "agents_update_admin" on public.agents; drop policy if exists "agents_delete_admin" on public.agents;
drop policy if exists "sources_select_member" on public.knowledge_sources; drop policy if exists "sources_insert_admin" on public.knowledge_sources; drop policy if exists "sources_update_admin" on public.knowledge_sources; drop policy if exists "sources_delete_admin" on public.knowledge_sources;
drop policy if exists "contacts_select_member" on public.contacts; drop policy if exists "contacts_insert_member" on public.contacts; drop policy if exists "contacts_update_member" on public.contacts; drop policy if exists "contacts_delete_admin" on public.contacts;
drop policy if exists "campaigns_select_member" on public.campaigns; drop policy if exists "campaigns_insert_admin" on public.campaigns; drop policy if exists "campaigns_update_admin" on public.campaigns; drop policy if exists "campaigns_delete_admin" on public.campaigns;

create policy "agents_select_member" on public.agents for select using(public.is_org_member(organization_id));
create policy "agents_insert_admin" on public.agents for insert with check(exists(select 1 from public.organization_members m where m.organization_id=agents.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and created_by=auth.uid());
create policy "agents_update_admin" on public.agents for update using(exists(select 1 from public.organization_members m where m.organization_id=agents.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))) with check(exists(select 1 from public.organization_members m where m.organization_id=agents.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "agents_delete_admin" on public.agents for delete using(exists(select 1 from public.organization_members m where m.organization_id=agents.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "sources_select_member" on public.knowledge_sources for select using(public.is_org_member(organization_id));
create policy "sources_insert_admin" on public.knowledge_sources for insert with check(exists(select 1 from public.organization_members m where m.organization_id=knowledge_sources.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and created_by=auth.uid());
create policy "sources_update_admin" on public.knowledge_sources for update using(exists(select 1 from public.organization_members m where m.organization_id=knowledge_sources.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))) with check(exists(select 1 from public.organization_members m where m.organization_id=knowledge_sources.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "sources_delete_admin" on public.knowledge_sources for delete using(exists(select 1 from public.organization_members m where m.organization_id=knowledge_sources.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "contacts_select_member" on public.contacts for select using(public.is_org_member(organization_id)); create policy "contacts_insert_member" on public.contacts for insert with check(public.is_org_member(organization_id)); create policy "contacts_update_member" on public.contacts for update using(public.is_org_member(organization_id)) with check(public.is_org_member(organization_id)); create policy "contacts_delete_admin" on public.contacts for delete using(exists(select 1 from public.organization_members m where m.organization_id=contacts.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "campaigns_select_member" on public.campaigns for select using(public.is_org_member(organization_id)); create policy "campaigns_insert_admin" on public.campaigns for insert with check(exists(select 1 from public.organization_members m where m.organization_id=campaigns.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and created_by=auth.uid()); create policy "campaigns_update_admin" on public.campaigns for update using(exists(select 1 from public.organization_members m where m.organization_id=campaigns.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))) with check(exists(select 1 from public.organization_members m where m.organization_id=campaigns.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))); create policy "campaigns_delete_admin" on public.campaigns for delete using(exists(select 1 from public.organization_members m where m.organization_id=campaigns.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));

-- Invitation token hashes must not be readable by ordinary organization members.
drop policy if exists "members read invitations" on public.organization_invitations;
drop policy if exists "owners admins manage invitations" on public.organization_invitations;
create policy "invitations_select_admin" on public.organization_invitations for select using(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "invitations_insert_admin" on public.organization_invitations for insert with check(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and invited_by=auth.uid() and role <> 'owner');
create policy "invitations_update_admin" on public.organization_invitations for update using(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))) with check(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and role <> 'owner');
create policy "invitations_delete_admin" on public.organization_invitations for delete using(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
