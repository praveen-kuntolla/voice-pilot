# Transactional safety acceptance — phases 4.13–4.16

Status: **accepted for review-only local simulation testing; blocked for production rollout**. Migrations 012–013 remain unapplied to the established local and remote databases. The rehearsal used one randomly named disposable database in the verified `voicepilot-local-loopback` database container and dropped it after rollback verification.

## Security findings and remediations

| Severity | Finding and evidence | Impact | Correction and regression evidence |
|---|---|---|---|
| High | Control mutations accepted a caller-supplied actor UUID and only checked whether that UUID was authorized. A service caller could attribute a change to another administrator. | Spoofed audit attribution and unauthorized stop/limit/budget changes through a faulty privileged caller. | Migration 013 now requires `p_actor` to equal the validated `request.jwt.claim.sub`. Missing and mismatched claims fail closed. The disposable test proves spoofed global stop, organization stop, limit and budget changes are rejected. |
| High | Stop writes and safety checks used row locks but had no common transaction lock. A stop could race after the final check and before an operation transaction committed. | A new reservation/accounting action could cross an emergency-stop boundary. | Shared global/organization advisory locks are acquired by `safety_enabled`; stop writers acquire matching exclusive locks. Concurrent drills prove stop writes wait for an existing safety-checked transaction and all fresh operations are rejected afterward. |
| Medium | `service_role` is intentionally cross-tenant and can set PostgreSQL request context. | Credential compromise or a faulty server authorization boundary can bypass tenant intent despite database actor matching. | No browser path receives the role and no live path uses the adapter. Production remains blocked pending a narrow server gateway, independent membership derivation, secret isolation/rotation and service-role misuse monitoring. |
| Medium | Cleanup is manual and `SKIP LOCKED` can leave locked expired rows for a later pass. | Unbounded retention if cleanup scheduling or alerting fails. | Bounded cleanup and retry are verified; production still requires scheduling, metrics, lag alerts and retention policy approval. |
| Medium | Safety audit rows are protected from client roles but production immutability, archival and external monitoring are not deployed. | A privileged database operator could alter evidence; incident detection remains incomplete. | Current grants and RLS deny client access. Production requires append-only retention controls, export to monitored storage and alerting. |

No SQL injection was found in the server adapter: every dynamic value is parameter-bound, and every SECURITY DEFINER routine fixes `search_path=pg_catalog` and schema-qualifies objects. Replay identity is tenant/provider/event bound. Reservation and usage conflicts remain transactionally serialized.

## Permission matrix

| Capability | PUBLIC / anon / authenticated | service_role | PostgreSQL owner |
|---|---|---|---|
| Read safety tables | Denied | SELECT only on global and organization stop tables | Administrative |
| Mutate safety tables directly | Denied | Denied | Administrative |
| Execute safety routines | Denied | Allowed | Administrative |
| Change controls | Denied | Routine only, with verified actor context and authorization | Administrative |
| Read private audit/usage state | Denied | No direct table grant | Administrative |

The service role is not sufficient evidence of a human actor. A future trusted gateway must set verified request context and independently bind organization membership.

## Disposable migration and rollback rehearsal

Sanitized execution record, 2026-10-26:

1. Verified Compose project `voicepilot-local-loopback`, dedicated volume `voicepilot-local-loopback-db`, and loopback-only API/pooler publications.
2. Verified the established database ledger is exactly migrations 001–011.
3. Created a random `vp_safety_*` disposable database.
4. Applied migrations 012 and 013 separately inside transactions.
5. Verified seven private safety tables, three required public indexes, constraints, RLS, least-privilege grants, fixed search paths and no PUBLIC/client routine execution.
6. Passed replay, reservation, rate, budget, stop, settlement, interruption, rollback and tenant-isolation drills.
7. Revoked service execution, dropped the `voicepilot_safety` schema and migration-012 tables in reverse dependency order inside a transaction.
8. Verified zero safety schemas, tables or routines remained while fixture organizations/users remained intact.
9. Dropped the disposable database. The established ledger remained 001–011.

## Proven concurrency invariants

- Exactly one of two simultaneous replay claims succeeds.
- One remaining tenant/provider reservation slot cannot be oversubscribed.
- Concurrent usage events cannot exceed a shared budget and duplicate/conflicting keys do not double charge.
- Global and organization emergency-stop writes serialize after already safety-checked transactions; subsequent operations fail closed.
- Locked cleanup rows are skipped safely and removed by a bounded retry.
- Transaction cancellation and rollback do not leave a replay claim; the database remains usable afterward.
- Expired usage reservations release held budget; invalid and conflicting settlements do not alter totals.

## Production blockers and operating requirements

1. **High:** implement and audit the trusted server gateway that derives actor/tenant context, isolates the service credential and performs fresh consent, opt-out, calling-hours and provider-policy checks.
2. **High:** complete human legal/compliance review for consent evidence, calling windows, opt-out, emergency handling, recording/transcription and regional retention.
3. **Medium:** deploy cleanup scheduling, retention limits, immutable audit export, metrics, alerts, reconciliation and incident procedures.
4. **Medium:** rehearse backup/restore, migration rollback and emergency-stop operator runbooks in a production-like isolated environment.
5. **Medium:** implement provider-specific webhook verification, idempotency reconciliation, cost ceilings and provider failure drills.

No LiveKit, telephony, STT, LLM, TTS, messaging, billing or provider connectivity test is approved by this acceptance. A first connectivity test requires separate approval, disposable provider credentials, an isolated tenant, outbound calling disabled, monitored emergency stop, and a written cleanup/revocation plan.
