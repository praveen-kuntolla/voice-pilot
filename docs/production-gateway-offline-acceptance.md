# Offline production-gateway acceptance

## Status

This gateway foundation is **offline-tested only**. It cannot dispatch calls, messages, LiveKit sessions, STT, LLM, or TTS work. Migrations 012–014 remain review-only and are applied only to a randomly named disposable database by `scripts/test-production-gateway.mjs`. The established local ledger remains 001–011.

## Trust boundary and transaction lifecycle

The server verifies the authenticated actor and organization membership, opens a PostgreSQL transaction, reduces the database role to `service_role`, binds the verified actor and organization with transaction-local settings, and then loads campaign, agent, contact, provider approval, quota, calling-hours, consent, concurrency, rate, and spend policy from PostgreSQL. The same transaction claims rate and replay protection, reserves concurrency, and reserves estimated spend. Any denial after a claim rolls the entire transaction back. Connections are always released; transaction-local identity is tested to be absent on reuse.

The pool refuses non-loopback or non-`vp_gateway_*` disposable targets in the local acceptance harness. Production must provide a dedicated, least-privilege server credential through a secret manager; browser code must never receive it. Rotation requires creating a replacement credential, validating read/routine permissions, draining the old pool, switching atomically, and revoking the old credential. Database and pool outages fail closed.

## Role and data rules

- `anon` and `authenticated` receive no access to private safety tables or privileged routines.
- `service_role` receives schema usage, selected policy/control reads, and only the restricted safety routines granted by migrations 012–014.
- Policy state is organization-bound and campaign/agent/contact ownership is independently checked.
- Provider policy must be enabled, both approvals must be active, and governance quota concurrency must match the safety limit.
- Consent must be explicitly granted and opt-out must be absent.
- Retry execution is not implemented. Migration 014 records a maximum, but this gateway prepares only attempt zero; production retries remain blocked until durable attempt accounting exists.

## Observability

Structured events cover authorization and consent denials, emergency stop, rate/concurrency/budget exhaustion, duplicate idempotency, pool failure, rollback, and transaction failure. Events contain a bounded correlation ID, optional organization ID, reason, and timestamp only. They exclude tokens, credentials, contact details, SQL, and provider payloads. The in-memory sink is test-only; production requires a durable, access-controlled sink with alerting for emergency-stop rejection, pool failure, repeated denials, and cleanup lag.

## Evidence and remaining blockers

The disposable acceptance test proves one-winner concurrency at capacity one, matching usage reservation, replay rollback, tenant denial, removed-membership denial, and transaction-local context cleanup through the real `pg` pool and Supavisor loopback endpoint. It also rechecks container identity, the independent volume, loopback publication, and the established 001–011 ledger before creating anything.

Production remains blocked on approved migration rollout, production RLS/role verification, a dedicated credential and rotation drill, distributed monitoring, durable retry-attempt accounting, cleanup automation, load/failure testing, and a separately approved provider-specific connectivity test. Rollback is to disable provider policies and feature flags, engage global emergency stop, drain gateway workers, revoke the credential, and preserve audit/usage evidence; destructive database rollback is not recommended.
