-- VOICEPILOT AI — READ-ONLY SCHEMA / SECURITY AUDIT
-- Run each labeled statement separately in Supabase SQL Editor.
-- Every statement is a SELECT against PostgreSQL catalog views.
-- No application rows, credentials, tokens, or message contents are selected.
-- No INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, GRANT, REVOKE, or RPC call occurs.

-- ============================================================================
-- SECTION 1 — TABLES, COLUMNS AND TYPES
-- ============================================================================
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema='public'
order by table_name, ordinal_position;

-- ============================================================================
-- SECTION 2 — PRIMARY KEYS, UNIQUE CONSTRAINTS AND INDEXES
-- ============================================================================
select n.nspname as schema_name, c.relname as table_name, i.relname as index_name,
       ix.indisunique, ix.indisprimary, pg_get_indexdef(ix.indexrelid) as index_definition
from pg_index ix join pg_class i on i.oid=ix.indexrelid join pg_class c on c.oid=ix.indrelid
join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.relname;

-- ============================================================================
-- SECTION 3 — FOREIGN KEYS AND DELETE/UPDATE ACTIONS
-- ============================================================================
select tc.table_name, kcu.column_name, ccu.table_name as foreign_table_name,
       ccu.column_name as foreign_column_name, rc.delete_rule, rc.update_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema
join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.table_schema=tc.table_schema
join information_schema.referential_constraints rc on rc.constraint_name=tc.constraint_name and rc.constraint_schema=tc.table_schema
where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' order by tc.table_name,kcu.column_name;

-- ============================================================================
-- SECTION 4 — RLS ENABLED / FORCED STATUS
-- ============================================================================
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname;

-- ============================================================================
-- SECTION 5 — EXACT RLS POLICY DEFINITIONS
-- ============================================================================
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname='public' order by tablename,policyname;

-- ============================================================================
-- SECTION 6 — SECURITY-DEFINER FUNCTIONS, SEARCH PATH AND OWNER
-- ============================================================================
select n.nspname as schema_name,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,
       p.proconfig as settings,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('is_org_member','create_organization','accept_organization_invitation');

-- ============================================================================
-- SECTION 7 — FUNCTION EXECUTION PRIVILEGES
-- ============================================================================
select routine_schema,routine_name,grantee,privilege_type
from information_schema.routine_privileges
where routine_schema='public' and routine_name in ('is_org_member','create_organization','accept_organization_invitation')
order by routine_name,grantee;

-- ============================================================================
-- SECTION 8 — INVITATION TOKEN CONSTRAINTS AND INDEXES
-- ============================================================================
select tc.constraint_name,tc.constraint_type,kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
where tc.table_schema='public' and tc.table_name='organization_invitations';
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='organization_invitations';

-- ============================================================================
-- SECTION 9 — MIGRATION METADATA DISCOVERY ONLY
-- ============================================================================
select table_schema,table_name from information_schema.tables
where table_name ilike '%migration%' order by table_schema,table_name;

-- ============================================================================
-- SECTION 10 — EXPECTED OBJECT EXISTENCE CHECK
-- ============================================================================
select to_regclass('public.profiles') as profiles,to_regclass('public.organizations') as organizations,
to_regclass('public.organization_members') as organization_members,to_regclass('public.organization_invitations') as organization_invitations,
to_regclass('public.audit_logs') as audit_logs,to_regclass('public.contact_submissions') as contact_submissions,
to_regclass('public.agents') as agents,to_regclass('public.knowledge_sources') as knowledge_sources,
to_regclass('public.contacts') as contacts,to_regclass('public.campaigns') as campaigns;

-- ============================================================================
-- SECTION 11 — SINGLE JSON METADATA REPORT
-- One row containing catalog metadata only. No application data is read.
-- ============================================================================
with table_info as (
  select c.table_name, jsonb_agg(jsonb_build_object(
    'column',c.column_name,'type',c.data_type,'udt',c.udt_name,
    'nullable',c.is_nullable,'default',c.column_default
  ) order by c.ordinal_position) as columns
  from information_schema.columns c where c.table_schema='public'
  group by c.table_name
), constraints_info as (
  select tc.table_name,jsonb_agg(jsonb_build_object(
    'name',tc.constraint_name,'type',tc.constraint_type,'column',kcu.column_name
  ) order by tc.constraint_name) as constraints
  from information_schema.table_constraints tc
  left join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.table_schema=tc.table_schema
  where tc.table_schema='public' group by tc.table_name
), policies_info as (
  select tablename,jsonb_agg(jsonb_build_object(
    'name',policyname,'command',cmd,'roles',roles,'using',qual,'check',with_check
  ) order by policyname) as policies
  from pg_policies where schemaname='public' group by tablename
), functions_info as (
  select p.proname,jsonb_agg(jsonb_build_object(
    'arguments',pg_get_function_identity_arguments(p.oid),
    'security_definer',p.prosecdef,'settings',p.proconfig,
    'owner',pg_get_userbyid(p.proowner)
  ) order by p.oid) as overloads
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('is_org_member','create_organization','accept_organization_invitation')
  group by p.proname
)
select jsonb_build_object(
  'tables',(select jsonb_agg(jsonb_build_object('table',t.table_name,'columns',t.columns) order by t.table_name) from table_info t),
  'constraints',(select jsonb_agg(jsonb_build_object('table',c.table_name,'constraints',c.constraints) order by c.table_name) from constraints_info c),
  'rls_policies',(select jsonb_agg(jsonb_build_object('table',p.tablename,'policies',p.policies) order by p.tablename) from policies_info p),
  'functions',(select jsonb_agg(jsonb_build_object('name',f.proname,'overloads',f.overloads) order by f.proname) from functions_info f)
) as voicepilot_schema_audit;
