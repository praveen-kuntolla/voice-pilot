-- PREPARED ONLY. Do not apply remotely without approval and preflight.
alter table public.contacts add column if not exists deleted_at timestamptz;
create index if not exists contacts_org_active_idx on public.contacts(organization_id) where deleted_at is null;
-- Application queries must add deleted_at is null before this migration is considered active.
