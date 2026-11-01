# Phase 12F SQL Security Approval Handoff

Status: review-only handoff. The SQL has not been applied or executed. This document is not an independent security approval.

## Scope reviewed

- `docs/review-only/20261101_phase12f_worker_leases.sql`
- `docs/phase-12f-implementation-contract.md`
- `docs/phase-12f-security-acceptance-matrix.md`
- `supabase/migrations/202610220017_durable_session_authorization.sql`
- `supabase/migrations/202610220018_transactional_session_admission.sql`

The review-only SQL contains seven intended security functions plus the audit-trigger function. The six lifecycle functions remain unique; the evidence-ingestion function and audit trigger are additional objects.

## Readiness findings

### Positive controls present

- `create_worker_lease` locks the authorization and admission binding before consuming authorization and inserting the lease.
- Failed consumption, lease insertion, or audit insertion occurs in one PostgreSQL transaction and rolls back the transaction.
- Release functions check the Boolean result of `release_voice_session_authorization` and raise on failure.
- Release completion locks lease, evidence, and authorization rows.
- Active-key, validity-window, timestamp-skew, nonce, room, participant, and session checks are present.
- Audit transition uniqueness and an update/delete rejection trigger are drafted.
- Untrusted table and function access is revoked by executable statements.

### Remaining technical defects

| Severity | Location | Defect | Smallest safe correction | Required test |
|---|---|---|---|---|
| High | `20261101_phase12f_worker_leases.sql:242-250` | `create_worker_lease` does not require `voice_admission_bindings.status = 'authorized'` or reject cancelled/expired bindings. Matching identity columns alone can permit a stale binding to be consumed. | Require `b.status = 'authorized'`, `b.expires_at > p_now`, and an approved authorization state before calling consume. | Cancelled, expired, and consumed binding denial. |
| High | `20261101_phase12f_worker_leases.sql:360-382` | `record_provider_termination_evidence` validates payload binding but does not authenticate the evidence producer or constrain `p_source` to a producer identity. | Grant it only to an approved server/provider role and bind source to `current_user` or a server-controlled producer registry. | Worker-role evidence insertion denial and producer mismatch. |
| High | `20261101_phase12f_worker_leases.sql:208-219` | `mark_worker_reconciliation_required` itself has no role or authorization check. Safety currently depends on grants remaining absent. | Add an explicit `current_user = 'voice_reconciliation_operator'` check and lock the lease before updating it. | Ordinary worker, client role, and wrong operator denial. |
| Medium | `20261101_phase12f_worker_leases.sql:51-75` | Audit inserts are not restricted to trusted transition functions; revoking untrusted roles does not constrain the table owner or service role. | Use a dedicated owner, revoke direct INSERT from all application roles, and add a trusted transition context/trigger for inserts. | Direct INSERT by worker, service, owner, and client roles. |
| Medium | `20261101_phase12f_worker_leases.sql:187-200` | Nonce uniqueness is scoped to `(key_id, path, nonce)`, which is appropriate for the documented contract, but no cleanup/retention authority is defined. | Define bounded nonce retention and an owner-controlled cleanup job that cannot delete unexpired nonces. | Replay before and after retention boundary. |
| Medium | `20261101_phase12f_worker_leases.sql:69-83` | Room/participant binding identity equality is procedural rather than composite relational enforcement. | Keep all writes behind one trusted admission RPC and add disposable tests proving no direct-write path exists. | Room, participant, tenant, and agent substitution. |

No SQL runtime correctness is claimed. The review-only file should not advance to migration application until these defects are corrected and independently reviewed.

## Human approval checklist

| Decision | Proposed technical option | Owner | Security impact | Approval evidence |
|---|---|---|---|---|
| Worker database role | Dedicated least-privilege gateway role; no direct table access | DBA/platform security | Prevents arbitrary worker mutation | Role DDL, grants, negative privilege tests |
| Reconciliation role | Separate `voice_reconciliation_operator`; no ordinary worker access | DBA/SRE/security | Limits capacity release authority | Provisioning record and role-denial tests |
| Function ownership | Dedicated non-login owner with fixed search paths | DBA/security | Controls `SECURITY DEFINER` power | Ownership query and privilege audit |
| Worker secrets | Secret-manager references, key IDs, overlap rotation, revocation | Platform security | Limits credential theft and rotation risk | Rotation/revocation test evidence |
| Termination evidence | Approved server/provider producer with authenticated ingestion | Provider/platform security | Prevents false release of active capacity | Producer identity and event-verification design |
| Audit retention | Append-only trigger plus approved retention policy | Compliance/DBA | Preserves forensic evidence | Mutation-denial and retention approval |
| Phase 12E cutover | PostgreSQL becomes sole authority after disposable compatibility pass | Architecture/security | Prevents unsafe dual-authority races | Cutover and rollback runbook |
| Disposable execution | Isolated loopback PostgreSQL/Supabase only | Security/DB owner | Prevents production impact | Environment approval and cleanup log |

## Disposable PostgreSQL verification plan

Use only the repository's isolated loopback stack and synthetic identities. Do not use production credentials or apply migrations to an established project.

1. Apply the review-only SQL to a randomized disposable database only after independent approval.
2. Provision two synthetic organizations, actors, agents, authorizations, bindings, and worker keys.
3. Verify organization, agent, actor, session, assertion, room, participant, and reservation identity matching.
4. Attempt cross-tenant, wrong-agent, wrong-actor, cancelled-binding, expired-binding, and missing-binding creation; expect denial and no reservation.
5. Inject lease/audit failure and verify authorization consumption rolls back.
6. Run concurrent creation for one authorization; expect one lease and one capacity reservation.
7. Test active, expired, revoked, and rotated worker keys for nonce, begin, and complete operations.
8. Replay the same nonce and release-attempt ID; expect deterministic denial or idempotent success without a second release.
9. Force a failed release RPC; verify lease remains unreleased and capacity remains reserved.
10. Submit terminated, failed, unreachable, stale, mismatched, and worker-claimed evidence; release only approved evidence.
11. Verify reconciliation requires the administrative role and cannot be called by the worker role.
12. Attempt audit `UPDATE`, `DELETE`, and direct `INSERT`; expect rejection for all unapproved roles.
13. Run the Phase 12E compatibility suite with the new authority disabled; confirm no browser behavior changes.
14. In `finally`, release synthetic reservations, verify zero active leases, drop only the randomized database, and confirm unrelated resources are unchanged.

## Gate recommendations

- Gate A — **NO-GO** until the six listed technical defects are corrected and independently reviewed. Static inspection alone is insufficient.
- Gate B — **NO-GO** until Gate A approval exists and disposable PostgreSQL tests execute successfully.
- Phase 12F.2 offline worker-lease implementation — **NO-GO** until the SQL contract, role ownership, and evidence boundary are approved.
- Production activation — **NO-GO**. Provider termination evidence, secret rotation, migration ownership, rollback, and real provider testing remain unapproved.

No SQL, migration, endpoint, worker, provider, LiveKit, microphone, or telephony operation was executed in preparing this handoff.

## Phase 12F.1O remediation update

The draft SQL now rejects non-`authorized`, expired, cancelled, and already
consumed admission bindings before consumption; validates lease-expiry input;
requires the reconciliation operator inside both reconciliation paths; and
restricts evidence ingestion to the proposed server/provider ingestor roles.

These are draft controls only. The role names are deployment prerequisites,
not provisioned identities. Audit INSERT authority still requires explicit
owner separation and trusted-function context enforcement, and all controls
remain pending independent review and disposable PostgreSQL verification.

## Phase 12F.1Q caller-authentication update

The ineffective `current_user` checks were removed from `SECURITY DEFINER`
functions. The candidate model uses a non-login function owner and explicit
`EXECUTE` grants to distinct gateway, reconciliation, and evidence-ingestor
roles. Evidence ingestion now fails closed until its trusted producer exists.
The SQL records, but does not yet implement, the required deterministic lock
order: authorization, binding, worker key, lease, release attempt, evidence,
audit. The feasible implementation instead uses family-specific orders: lease
creation is authorization/binding/key/lease/audit; release is
lease/evidence/authorization/key/attempt/audit; and evidence ingestion is
lease/evidence. This is an explicit dependency exception and remains subject
to cross-family concurrency testing; it is not a deadlock-free claim.

## Phase 12F.1S concurrency handoff

The actual dependency graph is:

- Creation: authorization row → admission binding row → worker-key row →
  authorization consumption (same authorization plus organization advisory
  lock) → lease unique indexes/foreign keys → audit insert.
- Begin: lease row → worker-key row → release-attempt primary key/unique index →
  audit insert.
- Completion: lease row → evidence row → authorization row → worker-key row →
  authorization release update/audit → lease update → lease audit insert.
- Reconciliation: lease row → evidence row → authorization row → authorization
  release update/audit → lease update → lease audit insert.
- Evidence ingestion: lease row → evidence unique index/foreign keys.
- Mark reconciliation: lease row → lease audit insert.
- Nonce claim: worker-key existence check → nonce primary key insert.

The strongest static concern is not a proven cycle but the cross-family
ordering difference: creation starts with authorization, while completion and
reconciliation start with lease. A cycle would require another transaction to
hold one of those rows and request the other; the current SQL does not itself
show a complete guaranteed cycle because creation only inserts a new lease and
release requires an existing lease. Foreign-key and unique-index waits remain
runtime dependencies and require PostgreSQL concurrency tests.

The test-only harness is
`scripts/test-phase12f-concurrency-harness.mjs`. It runs offline by default,
tests loopback/randomized-target validation and barriers, and refuses execution
unless an explicit disposable opt-in and randomized database URL are supplied.
Its execution path is intentionally disabled until independent approval and a
database adapter are provided. Planned scenarios are duplicate creation,
creation/cancellation, begin/complete, complete/reconciliation, evidence/release,
and provider-uncertainty release, with lock timeout and SQLSTATE `40P01`
collection required during future approved execution.

The prepared adapter is
`scripts/lib/phase12f-disposable-concurrency-adapter.mjs`. It reuses
`startDisposableVoiceGateway`, requires an explicit randomized loopback target,
review-SQL approval, and `execute: true`, and guarantees rollback, pool, and
gateway cleanup. Evidence-dependent scenarios remain blocked until their
producer and role approvals exist.
