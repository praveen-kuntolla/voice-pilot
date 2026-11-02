# Phase 12F Human Security Approval Request

Status: **PENDING HUMAN APPROVAL**. This request authorizes no migration, endpoint,
worker transport, LiveKit connection, provider call, or production change.

## Decision requested

Approve one disposable PostgreSQL verification run only if every mandatory
condition below is accepted and recorded by the responsible owners. This is not
approval for Phase 12F.2 implementation or production activation.

## Strict disposable-test scope

- One randomized database in the existing `voicepilot-local-loopback` stack.
- Loopback-only Supabase, PostgreSQL, REST, and application endpoints.
- Synthetic users, organizations, agents, sessions, authorizations, bindings,
  worker keys, and reservations only.
- Disposable test roles with no production credentials, customer data, or
  service secrets.
- Review-only SQL may be applied only to that randomized database after written
  approval and explicit runner opt-in.
- No LiveKit rooms or tokens, microphone capture, STT, LLM, TTS, telephony,
  worker dispatch, or provider activity.
- The runner must refuse non-loopback URLs, recognized production databases,
  missing approval flags, and non-randomized targets.

## Required owner decisions

| Owner | Decision | Required evidence | Status |
|---|---|---|---|
| Database/security | Approve the non-login function owner and exact `SECURITY DEFINER` ownership/search paths. | Ownership query, inheritance audit, fixed-path review. | **PENDING** |
| Database/security | Approve the worker gateway role and exact RPC `EXECUTE` grants; deny direct table access. | Grant DDL plus negative privilege tests. | **PENDING** |
| Database/security / SRE | Approve a separate reconciliation operator role and grants. | Role provisioning record and worker/client denial tests. | **PENDING** |
| Platform/LiveKit | Approve the evidence-ingestor identity and provider/server termination-evidence contract. | Authenticated producer design, binding rules, freshness and terminal-state evidence. | **BLOCKED** until producer is defined |
| Worker-key management | Approve secret-manager storage, key IDs, overlap rotation, revocation, expiry, and emergency recovery rules. | Rotation/revocation runbook and test evidence. | **PENDING** |
| Audit/compliance | Approve audit owner, trusted insertion path, append-only enforcement, privileged-owner controls, retention, and deletion policy. | Ownership/grant audit, mutation-denial tests, retention decision. | **PENDING** |
| Release/architecture | Approve Phase 12E compatibility, PostgreSQL authority cutover, feature flag, rollback, and reconciliation SLO. | Cutover/rollback runbook and compatibility evidence. | **PENDING** |
| Database/security | Authorize one disposable execution of the review-only SQL. | Written scope approval and environment capture. | **PENDING** |

## Security acceptance required before execution

The disposable run must demonstrate:

1. Atomic lease creation and authorization consumption, including rollback on
   lease or audit failure.
2. Cross-tenant and wrong organization, agent, actor, session, assertion, room,
   participant, reservation, and worker-key denial.
3. Rejection of cancelled, expired, stale, consumed, and duplicate bindings.
4. One successful lease under concurrent creation; no concurrency bypass.
5. Revoked, expired, rotated, stale, altered, and replayed worker requests denied.
6. Failed release leaves both lease state and capacity reserved.
7. Worker-only, stale, unreachable, mismatched, and unapproved provider evidence
   cannot release capacity.
8. Reconciliation callable only by the separately approved authority.
9. Audit `UPDATE`, `DELETE`, and direct `INSERT` denied for unapproved roles.
10. Phase 12E remains unchanged while the new authority is disabled.

Evidence-producer tests remain blocked until the platform owner approves the
producer identity and verification mechanism.

## Isolation, cleanup, and rollback guarantees

The runner must use `try/finally` cleanup on success, failure, cancellation, and
interruption. It must rollback open transactions, release synthetic reservations,
verify zero active leases, drop only the randomized database, remove only
test-owned fixtures/junctions, and record that unrelated containers and
databases were unchanged.

Rollback means disabling new Phase 12F calls while preserving active lease,
reservation, and audit evidence. Destructive removal of active evidence is not
an approved rollback.

## Known risks and blockers

- Review-only SQL has not received independent human approval or runtime
  PostgreSQL verification.
- Database role ownership, grants, inheritance, and privileged-owner bypasses
  are unresolved.
- No approved provider/server termination-evidence producer exists.
- Audit trusted insertion and retention ownership remain unresolved.
- Cross-family PostgreSQL concurrency and RLS behavior remain unexecuted.
- Phase 12E cutover and rollback have not been approved.

## Sign-off record

Approval must be recorded by the named human owners; absence of a name or date
means **not approved**.

| Decision | Owner name | Decision (Approve / Reject / Needs changes) | Date | Evidence link |
|---|---|---|---|---|
| Function owner and database grants |  |  |  |  |
| Reconciliation authority |  |  |  |  |
| Evidence producer |  |  |  |  |
| Worker-key lifecycle |  |  |  |  |
| Audit ownership/retention |  |  |  |  |
| Phase 12E cutover/rollback |  |  |  |  |
| Disposable SQL execution |  |  |  |  |

## Recommendation

Gate A: **CONDITIONAL NO-GO** pending the decisions above.

Gate B: **NO-GO** until Gate A is approved and the disposable suite passes.

Phase 12F.2: **NO-GO** until independent review, approved roles, evidence
boundary, and disposable verification are complete.

Production activation: **NO-GO**.
