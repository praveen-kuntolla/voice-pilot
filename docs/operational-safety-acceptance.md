# Operational safety acceptance (offline only)

## Status and architecture

VoicePilot remains simulation-only. Migration 015 is review-only and is exercised only after migrations 012–014 inside a randomly named disposable database. The established local ledger remains 001–011. No remote Supabase, provider, monitoring, billing, scheduler, or messaging service is contacted.

The trusted gateway verifies identity and membership, binds transaction-local actor and organization context, loads authoritative campaign/agent/contact/provider policy, then atomically reserves a durable synthetic attempt, rate slot, replay identity, concurrency slot, and estimated usage budget. Any later failure rolls back every claim. Attempt rows are tenant-bound and identify campaign, contact, agent, provider, kind, sequence, lifecycle state, expiry, and idempotency key.

## Retry state and guarantees

States are `reserved`, `completed`, `failed`, `cancelled`, and `expired`; kinds are `original` and `retry`. An advisory transaction lock serializes attempt allocation for one tenant/campaign/contact/provider identity. Live duplicate idempotency returns the original attempt, conflicting reuse fails, and the configured policy maximum is authoritative. Consent, opt-out, enabled policy, emergency stop, calling hours, membership, campaign and agent ownership are rechecked before each reservation. No row dispatches provider work.

## Cleanup and retention

`OperationalMaintenanceRunner` accepts only `vp_operational_*` disposable database names and bounded batches of at most 1,000. It invokes restricted routines for replay, released/expired concurrency, old rate windows, expired usage reservations, retry reconciliation, and retry retention, then reports counts and retry backlog age. PostgreSQL uses `FOR UPDATE SKIP LOCKED`; repeated runs are idempotent and active rows are not deleted. Failed/cancelled/expired retry rows are retained until an explicit cutoff; completed attempts, usage ledgers, safety audit, and gateway audit evidence are not deleted by this runner.

A future deployment needs a singleton lease or distributed scheduler lock, bounded retries, per-routine latency/error metrics, backlog-age alerts, and an operator runbook. Overlapping workers remain safe at row level but should still be prevented operationally.

## Audit and synthetic alerts

Gateway events are bounded to type, correlation ID, optional organization ID, reason, and timestamp. Credentials, tokens, SQL parameters, contact information, recordings, transcripts, and provider payloads are prohibited. Migration 015 stores events through a restricted routine and rejects row updates/deletes. Safety-critical sink failure throws `safety_audit_unavailable`; it must block the associated future action rather than claim successful audit recording.

Offline alert evaluation marks emergency-stop, pool, transaction, unsafe-client-discard, and credential-rotation failures critical. Tenant/type/reason-identical alerts are suppressed within a configured window. Production requires durable delivery, access control, retention approval, monitoring redundancy, and explicit handling when telemetry is unavailable.

## Credential and pool recovery rehearsal

The disposable harness creates two random local login roles, grants the existing service role, proves both can authenticate to the disposable database, revokes login on the old role, proves the old synthetic credential is rejected, and retains the replacement until teardown. Secrets are generated in process and never printed. A production rotation must create and validate a least-privilege replacement, warm a new pool, stop new work, drain the old pool, atomically switch, revoke the old login, monitor failures, and retain audit evidence. `SET ROLE` is defense in depth, not a credential substitute.

Connection loss fails closed. Failed rollback and uncertain commit discard the pool client. Recovery requires emergency stop, pool drain, database health verification, reconciliation of expired synthetic reservations, audit review, and controlled resumption. Never replay an uncertain action without checking its durable idempotency and attempt state.

## Evidence, findings, and blockers

High-severity gaps corrected offline: retry attempts previously had no durable identity or maximum enforcement; cleanup lacked a bounded orchestrator; and audit delivery had no fail-closed durable contract. Tests cover simultaneous attempt/concurrency claims, duplicate prevention, rollback, expiry reconciliation, repeated cleanup, tenant isolation, pool reuse/discard, budget exhaustion, and synthetic credential revocation.

This is not production readiness. Remaining blockers include independent database/security review, migration approval and rollback rehearsal, production least-privilege credentials, durable scheduler leadership, provider-specific idempotency semantics, immutable external audit retention, monitoring redundancy, backup/restore and disaster-recovery drills, load/chaos testing, privacy/legal review, telephony consent compliance, spend controls, and separately approved provider connectivity.
