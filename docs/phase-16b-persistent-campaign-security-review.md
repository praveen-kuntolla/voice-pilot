# Phase 16B — Persistent Campaign Architecture Security Review

Status: independent review draft; **not an approval**. No SQL was executed.

## Executive assessment

The proposal has a sound separation between saved audience configuration and consent, and it correctly keeps the only proposed run kind as `simulation`. This revision drafts composite tenant relationships and member-read policies, and specifies the lifecycle/idempotency contract. These are proposed controls only: they have not been applied, parsed by PostgreSQL, or tested.

## Findings

### Critical — cross-tenant relationships are not enforced by the draft SQL — RESOLUTION DRAFTED, NOT VERIFIED

The revised draft now proposes composite foreign keys for assignments, runs, and events (`20261102_phase16_campaign_audience_runs.sql:33-83`) and documents prerequisite composite keys on existing campaign/contact tables. This removes the design gap on paper, but the prerequisite constraints and disposable application remain unverified.

Remediation status: drafted, pending PostgreSQL parser/migration verification and cross-tenant insert, run-read, and event-read tests.

### Critical — RLS is enabled but no policies or grants are defined — PARTIALLY RESOLVED, NOT VERIFIED

The revised SQL drafts member SELECT policies (`20261102_phase16_campaign_audience_runs.sql:99-105`) and still leaves mutation revokes, function bodies, and grants as deployment prerequisites (`:107-116`). This is not yet a complete least-privilege contract.

Remediation: specify exact SELECT policies for members, mutation policies/RPC-only access for owner/admins, `REVOKE` from untrusted roles, and approved function-owner/execute-role grants. Test anon, authenticated member, viewer, admin, and cross-tenant access.

### High — run state transitions are not database-enforced — CANDIDATE RPC DRAFTED, NOT VERIFIED

The `state` check permits every listed state but does not restrict transitions (`:45`). A caller could potentially move `completed` back to `running`, cancel a terminal run, or append events out of order unless every path is perfectly protected by an RPC.

Remediation status: candidate transition RPC and version column are drafted; PostgreSQL execution, terminal-event coupling, and concurrent-writer tests remain pending.

### High — idempotency does not bind retries to the original request — CANDIDATE RPC DRAFTED, NOT VERIFIED

The unique key prevents duplicate rows but `request_fingerprint` is not compared by a constraint or specified RPC result (`:46-55`). A retry with the same key and different audience/campaign could receive or mutate the wrong run.

Remediation status: candidate run-creation RPC locks and compares organization, campaign, audience, and fingerprint; actor-scope semantics and concurrent tests remain pending.

### High — audit events are not append-only — CANDIDATE WRITER DRAFTED, IMMUTABILITY UNRESOLVED

`campaign_run_events` has uniqueness and bounded sequence numbers, but no owner, trigger, policy or trusted insert function prevents UPDATE/DELETE/direct INSERT (`:61-71`). The metadata key blacklist is not a complete sensitive-data boundary because arbitrary keys or encoded values remain possible.

Remediation: revoke direct mutation, add immutable triggers/ownership controls, restrict event insertion to transition functions, and validate an allowlisted typed metadata shape rather than only forbidden keys. Document superuser/migration-owner limitations.

### Medium — consent snapshot and assignment lifecycle are underspecified

The document requires revalidation, but the SQL has no audience version/snapshot table or assignment eligibility evidence. Concurrent consent changes during run creation need a defined lock/isolation rule.

Remediation: lock contacts during snapshot creation, record a redacted eligibility decision/version, and fail the run if the contact changes before commit. Never convert an assignment into consent.

### Medium — retention and deletion semantics are not enforceable

The proposal mentions bounded retention, but no purge authority, retention columns, tombstone policy, or event deletion model exists. Cascading deletes on organizations/runs may remove evidence unexpectedly (`:6-7`, `:41-43`, `:63-64`).

Remediation: obtain an audit-retention decision, define legal deletion behavior, and make purge/reconciliation authority explicit before migration design.

### Low — audience identity/version semantics need clarification

The prose says “campaign/version,” but the table has no version or immutable snapshot identifier. Reusing a mutable audience while a run is being reviewed can make results difficult to reproduce.

Remediation: add immutable audience revisions or a run snapshot table with a content hash and bounded selected-contact rows.

## Threat model conclusions

- Cross-tenant injection is prevented only if composite relationships and RPC checks are both enforced; the current draft does not prove this.
- Forged run IDs must resolve through tenant-scoped RLS and authoritative campaign/audience checks; IDs alone are not authorization.
- Stale consent must block run creation and transition, including concurrent updates; client snapshots are never evidence.
- Duplicate runs require unique-key locking plus fingerprint comparison.
- Role escalation is prevented only by explicit RLS, revokes, and approved RPC grants; comments are insufficient.
- Terminal events must be generated by transition functions, not clients or workers.
- Reports must expose counts and redacted contact references only; no phone numbers or raw metadata.
- The simulation endpoint must reject all kinds other than `simulation` server-side, with no provider reservation or Phase 12F release path.

## Human approval checklist

| Decision | Owner | Status |
|---|---|---|
| Composite tenant foreign-key strategy | Database/security owner | PENDING |
| RLS policies and direct-table revokes | Database/security owner | PENDING |
| Function owner and execute roles | Platform/security owner | PENDING |
| Audience version and snapshot retention | Architecture/data owner | PENDING |
| Idempotency conflict semantics | API/architecture owner | PENDING |
| Append-only audit owner and retention | Audit/compliance owner | PENDING |
| Simulation-only rollout and rollback flag | Release owner | PENDING |
| Any future provider-backed run authority | Security + provider owner | BLOCKED until separate review |
| Disposable PostgreSQL execution authorization | Database/security owner | PENDING |

## Required disposable verification plan

In a randomized loopback database only:

1. Apply the reviewed migration only after approval and verify schema prerequisites.
2. Create synthetic organizations, owner/admin/member/viewer users, agents, campaigns and contacts.
3. Test cross-tenant assignment, read, update, delete, run creation and event access.
4. Test duplicate active assignments and concurrent assignment/removal.
5. Change consent and `opted_out_at` after assignment; verify run creation and transition block.
6. Test same-key retries, fingerprint conflicts, concurrent run creation, cancellation and terminal-state rejection.
7. Attempt direct event INSERT/UPDATE/DELETE as untrusted roles.
8. Verify bounded event count/metadata and absence of phone numbers.
9. Confirm simulation-only runs cannot reserve providers or create leases.
10. Roll back by disabling the feature, then verify cleanup of only test-owned rows and databases.

## Resolution status

The Critical tenant-key design is now drafted with composite unique/FK proposals. The RLS read boundary is drafted, while mutation revokes, function ownership, append-only enforcement and transition RPC bodies remain pending. High findings are therefore **not closed** and no gate is approved.

The review-only SQL now contains candidate RPC bodies for assignment, simulation-run creation, versioned transitions, and event insertion. The transition and event functions still require independent review for terminal-event coupling, owner-role behavior, direct-table bypass, and PostgreSQL execution semantics.

## Production prerequisites

No production rollout is recommended. Before implementation approval: resolve all Critical/High findings, write executable RLS/RPC/grant contracts, perform independent SQL review, pass disposable concurrency/RLS tests, and obtain a separate Phase 12F/provider-security decision before any non-simulation run exists.
