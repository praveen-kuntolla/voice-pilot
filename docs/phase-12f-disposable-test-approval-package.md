# Phase 12F Disposable PostgreSQL Test Approval Package

Status: approval package only. No Phase 12F SQL has been executed, and this is not independent human security approval.

## Executive decision summary

The review-only SQL and test-only concurrency adapter are prepared for an
authorized disposable verification run. Execution remains blocked until the
role, ownership, evidence, and test-environment decisions below are approved.

Recommended decision: approve only a randomized loopback disposable run after
all mandatory conditions are evidenced. Do not approve production migration,
worker transport, provider activation, or Phase 12E cutover from this package.

## Approval matrix

| Decision | Proposed technical option | Security implication | Responsible owner | Required evidence | Status |
|---|---|---|---|---|---|
| Function ownership | Dedicated non-login, non-superuser `voicepilot_safety_owner` | Limits `SECURITY DEFINER` power and separates applications from ownership | DBA/security | Ownership query, fixed search paths, inheritance audit | Pending |
| Worker gateway role | Non-login, non-superuser role with only approved lease/nonce RPC `EXECUTE` | Prevents direct worker table mutation | DBA/platform security | Exact grants and negative table-access tests | Pending |
| Reconciliation role | Separate non-login operator role with only reconciliation RPCs | Prevents ordinary workers releasing capacity | DBA/SRE/security | Role provisioning and denial tests | Pending |
| Evidence-ingestor role | Separate role for verified server/provider adapter only | Prevents workers manufacturing termination evidence | Provider/platform security | Producer authentication and event-verification design | Pending |
| Worker-key secrets | Secret-manager references, key IDs, bounded overlap rotation, revocation | Limits credential theft and stale-key use | Platform security | Provisioning, rotation, revocation evidence | Pending |
| Termination evidence | Server/provider-authenticated event bound to lease, room, participant, session | Prevents release while provider state is uncertain | Provider/platform security | Signed/event-backed evidence contract | Pending |
| Audit controls | Dedicated owner, trusted transition inserts, append-only trigger, retention policy | Preserves forensic evidence; privileged bypasses remain operational risk | DBA/compliance | INSERT denial, UPDATE/DELETE denial, retention policy | Pending |
| Phase 12E compatibility | Keep new authority disabled; cut over only after disposable parity tests | Prevents unsafe dual-authority behavior | Architecture/security | Cutover, rollback, and compatibility results | Pending |
| Disposable execution | Explicit approval for randomized loopback database only | Limits test impact and prevents production access | Security/database owner | Written approval and environment capture | Pending |

## Approved-test boundary

Phase 12F SQL may be executed only when all of the following are true:

- Database host and Supabase services are loopback-only.
- The database name is randomized and owned exclusively by the test run.
- Synthetic users, organizations, agents, sessions, and keys are used.
- Test roles are disposable and do not reuse production credentials or secrets.
- The review-only SQL is explicitly approved for this isolated run.
- No LiveKit room, token, microphone, STT, LLM, TTS, telephony, or provider call is enabled.
- The runner has a `finally` cleanup path and records cleanup evidence.
- The test refuses non-loopback URLs, unrecognized databases, missing approval flags, and production-style credentials.

The adapter must reuse the existing disposable gateway lifecycle and must not
apply production migrations or touch unrelated containers/databases.

## Expected regression tests

The authorized run should verify:

1. Duplicate and concurrent lease creation yields one lease and one reservation.
2. Creation rollback leaves authorization and capacity unchanged after lease or audit failure.
3. Cross-tenant, wrong-agent, wrong-actor, wrong-session, wrong-assertion, room, and participant attempts fail closed.
4. Cancelled, expired, and consumed bindings cannot create leases.
5. Revoked, expired, and rotated keys cannot claim nonces or release leases.
6. Nonce and release-attempt replay is rejected or idempotent without a second release.
7. Failed authorization release rolls back the lease transition.
8. Evidence with `unreachable`, stale, mismatched, or worker-only claims cannot release capacity.
9. Reconciliation requires the separately approved operator role.
10. Audit UPDATE, DELETE, and direct INSERT attempts are denied for unapproved roles.
11. Phase 12E remains unchanged while the new authority is disabled.

Evidence-producer tests are blocked until the producer identity and verification
mechanism are approved. Role/grant tests are blocked until disposable role
ownership and exact grants are approved.

## Cleanup requirements

Cleanup must run on success, failure, cancellation, and interrupted child
processes. It must rollback open transactions, release synthetic reservations,
verify zero active leases, drop only the randomized database, remove only
test-owned fixtures, and confirm unrelated containers and databases were not
modified.

## Remaining blockers

- No human approval for function owner or database roles.
- No approved provider/server termination-evidence producer.
- Audit trusted-insert ownership and retention remain unresolved.
- Cross-family PostgreSQL concurrency behavior has not been executed.
- No PostgreSQL parser/runtime validation has been performed in this task.

## Gate recommendations

- Gate A — **CONDITIONAL NO-GO**: package is ready for human approval, but SQL execution is not authorized yet.
- Gate B — **NO-GO** until all approval conditions are evidenced and the disposable suite actually passes.
- Phase 12F.2 — **NO-GO** pending Gate B and independent review.

Offline checks do not establish SQL runtime correctness, deadlock freedom,
production readiness, or independent security approval.

## Final approval checklist

Statuses below reflect repository evidence only; no approval is inferred.

| Decision | Status | Evidence and required action |
|---|---|---|
| Function-owner role | PENDING | Candidate owner is documented; no role provisioning or ownership audit exists. DBA/security approval required. |
| Worker gateway role and RPC grants | PENDING | Candidate grants are comments only; exact disposable grants and direct-table denial must be approved and tested. |
| Reconciliation operator role | PENDING | Role boundary is specified but not provisioned or tested. |
| Evidence-ingestor role | BLOCKED | Evidence ingestion is fail-closed until an authenticated producer and verification mechanism are approved. |
| Worker-key lifecycle | PENDING | Key validity checks exist, but secret-manager provisioning, rotation, and revocation evidence is absent. |
| Audit ownership and retention | PENDING | Append-only trigger is drafted; owner/service-role bypass controls and retention policy are not approved. |
| Phase 12E compatibility/cutover | PENDING | New authority remains disabled; no approved cutover or rollback evidence exists. |
| Disposable SQL execution | PENDING | Must receive explicit security/database-owner authorization for one randomized loopback database. |

## Authorized next engineering step

The existing concurrency adapter is technically prepared for a future approved
run: it reuses the disposable gateway lifecycle, validates loopback and
randomized targets, requires explicit opt-in flags, supports multiple
connections and cleanup, and remains disabled by default. Offline checks have
passed, but this is not runtime verification.

The only permitted next step is for the responsible human owners to approve
the checklist above and authorize a single isolated disposable PostgreSQL run.
That run may use only synthetic identities, randomized loopback resources,
disposable roles, and existing test-owned cleanup. It may not use production
credentials, production databases, customer data, LiveKit, microphones, STT,
LLM, TTS, telephony, or any live provider activity.

Until the approvals are recorded, no Phase 12F SQL execution is authorized.
