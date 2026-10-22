-- READ-ONLY preflight for migration 005. Run before any remote approval.

-- A. Confirm target tables and required columns.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns where table_schema='public' and table_name in ('agents','knowledge_sources','contacts','campaigns','organization_invitations')
order by table_name,ordinal_position;

-- B. Detect cross-organization campaign/agent assignments.
select c.id as campaign_id,c.organization_id as campaign_org,a.id as agent_id,a.organization_id as agent_org
from public.campaigns c join public.agents a on a.id=c.agent_id
where c.organization_id<>a.organization_id;

-- C. Confirm trigger/function coverage for campaign-agent isolation.
select trigger_name,event_manipulation,event_object_table,action_statement
from information_schema.triggers where trigger_schema='public' and event_object_table='campaigns';
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.prosecdef,p.proconfig
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='validate_campaign_agent_organization';

-- D. List all policies, including possible legacy overlaps.
select schemaname,tablename,policyname,cmd,roles,qual,with_check
from pg_policies where schemaname='public' and tablename in ('agents','knowledge_sources','contacts','campaigns','organization_invitations')
order by tablename,policyname;

-- E. Verify invitation token-hash uniqueness and absence of member-readable policy.
select tc.constraint_name,tc.constraint_type,kcu.column_name
from information_schema.table_constraints tc left join information_schema.key_column_usage kcu
on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
where tc.table_schema='public' and tc.table_name='organization_invitations';
select policyname,cmd,roles,qual,with_check from pg_policies
where schemaname='public' and tablename='organization_invitations';

-- F. Check function execution privileges and SECURITY DEFINER metadata.
select routine_name,grantee,privilege_type from information_schema.routine_privileges
where routine_schema='public' and routine_name in ('accept_organization_invitation','validate_campaign_agent_organization');
