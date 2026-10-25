# Provider governance persistence

## Scope

Migration `202610220007_provider_governance.sql` defines the persistent
provider-governance data model. Migration `202610220008_governance_hardening.sql`
adds indexes, update timestamps, tightly scoped RPCs, and additional guards.
They are local-test migrations only and must not be applied remotely without a
separate schema preflight and explicit approval.

## Schema and ownership

The model has organization provider approvals, agent provider approvals,
privacy policies, provider quotas, session reservations, session usage,
organization daily summaries, stable-id usage events, and immutable provider
audit events. Every mutable record is organization-scoped; agent-bearing
records use a trigger to ensure the agent belongs to the same organization.
Credential references are opaque identifiers only. There is no API-key column
and no audit metadata field may include credentials, transcripts, or audio.

## Access model

Only organization owners/admins can read or change approvals, privacy policy,
and quotas. Members and viewers have no governance write access. Usage,
reservation, and summary tables have RLS enabled with no client write policy.
Audit rows are admin-readable and have no client mutation policy. Membership is
checked at query/RPC time, so revoking membership immediately removes access.

The authenticated usage/audit read RPCs independently verify
`is_org_admin(organization_id)` inside their security-definer queries. This
prevents a caller from selecting an arbitrary organization by parameter. The
internal accounting RPCs are service-role-only and are not exposed by a
user-facing route.

## Atomic accounting

Session reservation and usage recording take a transaction-scoped advisory lock
per organization/provider. Reservations clear expired records, enforce an
organization/provider concurrency cap, and are idempotent for the same session.
Usage is deduplicated by stable `event_id`; a transaction checks session and
organization estimated budgets before inserting the event and incrementing both
summary rows. Failed budget checks roll back the event. Costs are estimates,
not provider invoices.

## Local verification

Run only after Docker is running and `npx supabase status` confirms every
Supabase endpoint is loopback-only. These are non-destructive commands for the
existing disposable local stack:

```powershell
npx supabase migration list --local
npx supabase migration up --local
& ./scripts/local-supabase-fixtures.ps1 -Action setup
node scripts/local-provider-governance-test.mjs
& ./scripts/local-supabase-fixtures.ps1 -Action cleanup
```

The fixture/test script refuses a non-local API URL and checks cross-tenant
reads/writes, member restrictions, agent mismatch, audit immutability,
idempotency, budgets, reservation concurrency, and membership revocation.
Review the read-only SQL checklist at
`supabase/verification/migration_008_rls_check.sql` before any future remote
review. None of these commands authorizes remote migration application.

## Remaining blockers

- Local Docker/Supabase must be running to complete database-backed verification.
- Remote migrations 003–008 remain approval-gated, and remote schema/RLS drift
  needs a fresh read-only preflight.
- Production internal accounting needs a worker identity/credential rotation
  design, billing reconciliation, alerting, and failure recovery policy.
- Provider activation, credentials, live audio, and external provider testing
  remain separately prohibited until explicitly approved.
