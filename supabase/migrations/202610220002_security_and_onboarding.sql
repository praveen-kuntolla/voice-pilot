-- Additive hardening migration. Apply after 202610220001_phase1.sql.
alter table public.organizations add column if not exists business_use_case text not null default '';
create or replace function public.create_organization(p_name text, p_industry text, p_country text, p_timezone text, p_business_use_case text)
returns public.organizations language plpgsql security definer set search_path=public as $$
declare v_org public.organizations;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.organizations(name,industry,country,timezone,business_use_case,created_by)
  values(trim(p_name),trim(p_industry),trim(p_country),trim(p_timezone),trim(p_business_use_case),auth.uid()) returning * into v_org;
  insert into public.organization_members(organization_id,user_id,role) values(v_org.id,auth.uid(),'owner');
  return v_org;
end; $$;
revoke all on function public.create_organization(text,text,text,text,text) from public;
grant execute on function public.create_organization(text,text,text,text,text) to authenticated;
drop policy if exists "members read membership" on public.organization_members;
create policy "members read membership" on public.organization_members for select using(public.is_org_member(organization_id));
create policy "owners admins manage invitations" on public.organization_invitations for all using(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin'))) with check(exists(select 1 from public.organization_members m where m.organization_id=organization_invitations.organization_id and m.user_id=auth.uid() and m.role in ('owner','admin')) and role <> 'owner');
create policy "members read invitations" on public.organization_invitations for select using(public.is_org_member(organization_id));
create policy "members insert audit" on public.audit_logs for insert with check(public.is_org_member(organization_id) and actor_id=auth.uid());
