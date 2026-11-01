# Phase 11C Durable Usage and Emergency Stop

## Status

Review-only offline foundation. Migration 019 has not been applied to the
established local database or any remote database. Provider activation remains
disabled.

## Architecture

`voicepilot_safety.provider_session_reservations` is the PostgreSQL authority
for organization and agent session leases. Organization and agent advisory
transaction locks serialize competing reservations. Expired active leases are
reconciled before a new reservation. A unique session key makes identical
retries idempotent and prevents a terminal session from being recreated.

`provider_usage_accounts` stores bounded reserved and consumed units. Each
usage event is uniquely identified by `(organization_id,event_id)`, so retries
do not double-count. `record_provider_usage` reserves units transactionally;
`settle_provider_usage` converts a reservation to consumed units and
`release_provider_usage` returns unused reservation capacity.

All units are integer synthetic usage units. They are not provider-billed
seconds, tokens, dollars or invoices. The database does not store audio,
transcripts, phone numbers or provider secrets.

## Emergency stop and lifecycle

Admission calls the existing `voicepilot_safety.safety_enabled` control, which
checks organization and global safety state. A stopped organization cannot
reserve a new session. Release and usage settlement are explicit, bounded and
idempotency-safe. A lease expiry is recovery metadata; it does not prove that a
real provider disconnected.

An emergency-stop flag cannot remove a real provider participant by itself.
Provider-side cancellation, webhook confirmation and durable reconciliation
remain future integration work.

## Security boundaries

- Tables have RLS enabled and no client-role privileges.
- Functions are `SECURITY DEFINER` with a fixed search path and execute grants
  only to `service_role`.
- Organization context is checked from the transaction-local setting.
- Agent ownership and existing emergency-stop policy are checked before lease
  creation.
- Database errors must fail closed at the server and worker gateway.
- Redis or process-local state may assist diagnostics but is not authoritative.

## Acceptance evidence

The existing Ubuntu disposable PostgreSQL workflow is the authoritative path.
The Phase 11C acceptance extension covers organization/agent concurrency,
duplicate reservation retry, release, usage event idempotency, quota boundary,
emergency-stop denial, database failure and randomized database cleanup.

Windows local checks do not apply migrations because `psql` is unavailable.
Authenticated browser tests are not required for this offline SQL-only change
and are reported separately when not run.

## Remaining limitations and approvals

Independent human PostgreSQL/Supabase review is required before applying 019.
Production approval additionally requires provider-specific disconnect
semantics, distributed cleanup/reconciliation, real usage-meter validation,
rate limiting, spend controls, retention policy, operational monitoring and a
tested emergency-stop runbook. No live provider, microphone, room, billing or
customer-data operation is enabled by this phase.
