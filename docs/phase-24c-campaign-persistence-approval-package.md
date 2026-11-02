# Phase 24C — Campaign persistence security approval package

Status: **approval package / review only**. This document consolidates existing design and review evidence; it is not a database, security, production, provider, Phase 12F, or migration approval.

No SQL or migration has been executed, including against disposable PostgreSQL. No persistent campaign audience/run implementation is authorized by this package.

## Executive decision summary

Phase 16 provides a coherent candidate design for tenant-scoped campaign audiences, immutable audience revisions, simulation-only runs, and bounded run events. Phase 16B and 16E correctly identify that the design is not independently approved or runtime-verified.

Decision: **NO-GO for implementation and SQL execution at this time.**

The only conditionally acceptable scope is continued offline/browser simulation using the existing non-persistent contracts. Persistent audiences, durable runs, RPCs, RLS changes, grants, or campaign history must wait for independent database/security review and the evidence listed below.

No requirement in this package is marked Approved without independent reviewer evidence. Existing local unit/browser evidence proves application behavior only; it does not prove PostgreSQL parser correctness, RLS, grants, function ownership, concurrency, or production authorization.

## Current boundary

The current application persists tenant-scoped campaigns and contacts. Campaign APIs use authenticated server-side membership and owner/admin writes. Campaign readiness revalidates agent/campaign/organization and consent state for an offline rehearsal. Audience selection is session-local; simulation events are browser-local synthetic activity. There is no durable audience, run, event, scheduler, queue, or trusted campaign-run writer.

## Proposed architecture inventory

All items below are candidates from `docs/review-only/20261102_phase16_campaign_audience_runs.sql`; they remain unexecuted.

### Proposed tables

| Table | Intended responsibility | Proposed controls/indexes | Current decision |
| --- | --- | --- | --- |
| `public.campaign_audiences` | Tenant-owned named audience attached to a campaign | Organization/campaign identity, status, creator, campaign index, composite uniqueness | Not yet reviewed |
| `public.campaign_audience_contacts` | Assignment/removal history for audience contacts | Same-tenant audience/contact FKs, active-assignment partial unique index, tenant/audience/removal index | Not yet reviewed |
| `public.campaign_audience_revisions` | Immutable audience revision/hash used by runs | Tenant/audience/revision uniqueness, snapshot hash | Not yet reviewed; revision semantics need clarification |
| `public.campaign_runs` | Durable run header, simulation kind, lifecycle, idempotency and snapshot hash | Tenant/campaign/audience composite FKs, unique tenant/idempotency key, version, created-time index | Not yet reviewed |
| `public.campaign_run_events` | Bounded redacted lifecycle events | Tenant/run composite FK, sequence uniqueness, event allowlist, metadata bound, tenant/run/sequence index | Not yet reviewed; append-only enforcement absent |

### Proposed RLS policies

The draft contains candidate member `SELECT` policies using `public.is_org_member(organization_id)` for all five tables. It intentionally omits client mutation policies and comments that direct DML must be revoked. Exact member visibility, owner/admin mutation behavior, service-role bypass, organization deletion, and event privacy are not runtime-verified.

### Proposed RPCs/trusted writers

1. `assign_campaign_contact(audience_id, contact_id, expected_revision)` — owner/admin, same-tenant contact, revision check, row locks.
2. `create_campaign_simulation_run(campaign_id, audience_id, idempotency_key, request_fingerprint, expires_at)` — owner/admin, tenant/campaign/audience checks, contact locks, consent revalidation, exact-retry behavior.
3. `transition_campaign_simulation_run(run_id, expected_version, next_state)` — owner/admin, state graph, optimistic version, terminal-state guard.
4. `append_campaign_run_event(run_id, sequence_no, event_type, redacted_metadata)` — intended trusted writer, bounded allowlisted event, tenant derivation, sequence uniqueness.

The draft function bodies are candidates only. Function ownership, `SECURITY DEFINER` safety, fixed search paths, actor binding, execute grants, terminal-event coupling, and direct-table bypass resistance are unresolved.

### Proposed grants and trusted boundaries

The draft comments propose revoking all table DML from `public`, `anon`, and `authenticated`, and granting only approved RPC execution to a dedicated API executor. Exact role names, owners, inheritance, pooler behavior, service-role behavior, reconciliation authority, and worker authority are intentionally unspecified and require approval.

The browser must never choose authoritative organization, actor, consent, revision, run state, event sequence, or provider kind. A trusted server/RPC must derive identity from the authenticated context and lock/revalidate all parent rows.

## Risk register and closure evidence

| ID | Risk/blocker | Severity | Required closure evidence | Owner | Decision |
| --- | --- | --- | --- | --- | --- |
| R1 | Composite prerequisites and same-tenant FKs may not parse or enforce correctly | Critical | Independent SQL review; disposable insert/update tests for cross-tenant campaign, audience, contact, run and event references | Database/security | Not yet reviewed |
| R2 | RLS has candidate reads but no verified mutation revokes/grants | Critical | Exact role/grant matrix; anon/authenticated/member/viewer/admin negative tests; direct DML denial | Database/security | Not yet reviewed |
| R3 | `SECURITY DEFINER` owner/search path and privilege boundaries are unspecified | Critical | Approved function owner, fixed `search_path`, execute grants, role inheritance audit, wrong-role denial tests | Platform/security | Not yet reviewed |
| R4 | Run state transitions may permit illegal terminal/replay transitions | High | Executed transition matrix, terminal immutability tests, expected-version conflict tests, event coupling proof | API/architecture + database | Not yet reviewed |
| R5 | Idempotency key may return the wrong run for a changed request | High | Canonical fingerprint contract; exact retry and same-key-different-parent conflict tests under concurrency | API/architecture | Not yet reviewed |
| R6 | Run events are not proven append-only | High | Direct UPDATE/DELETE/INSERT denial, trusted-writer-only insertion, duplicate sequence/replay tests, owner-bypass analysis | Database/security + audit | Not yet reviewed |
| R7 | Concurrent consent revocation can race run creation | Critical | Transaction/isolation decision; concurrent revoke/create test proves block or stale outcome; no stale snapshot authorization | Data/security | Not yet reviewed |
| R8 | Audience mutation and run snapshot revision semantics are incomplete | High | Immutable revision contract; stale expected-revision tests; concurrent add/remove conflict behavior | Architecture/data | Not yet reviewed |
| R9 | Cancellation/emergency-stop semantics are not coupled to a trusted authority | High | Simulation cancellation tests; explicit future provider/emergency-stop boundary; Phase 12F dependency decision | Safety/release | Not yet reviewed |
| R10 | Retention/deletion may erase evidence or orphan derived records | Medium/high | Retention owner decision, legal hold policy, purge/tombstone semantics, idempotent deletion/reconciliation tests | Audit/compliance + data | Not yet reviewed |
| R11 | Event metadata blacklist is not a complete privacy boundary | High | Typed allowlist schema, size/count limits, encoded-sensitive-data tests, redacted API snapshots | Audit/privacy | Not yet reviewed |
| R12 | Persistent history could be mistaken for production calls | Medium | Separate simulation history mode/labels and authenticated UI regression tests | Product/release | Conditionally approved only for simulation-only UX work |
| R13 | Provider/worker/LiveKit authority could be accidentally coupled to simulation runs | Critical | Server-side `kind = simulation` enforcement, no lease/reservation/provider writes, separate future security review | Security/provider owner | Rejected for this package |

## Required approval owners

- Database/security owner: schema prerequisites, composite FKs, RLS, revokes, role ownership, grants, parser/runtime verification.
- Platform/security owner: `SECURITY DEFINER` owner, search paths, API executor, service-role boundary, secret and pooler behavior.
- Architecture/API owner: state machine, idempotency/fingerprint, revisions, API contracts, conflict semantics.
- Data/privacy/audit owner: event fields, redaction, retention, legal holds, deletion, audit ownership.
- Safety/release owner: cancellation, emergency stop, simulation-only flag, rollback and feature-disable behavior.
- SRE/operations owner: disposable environment, concurrency harness, monitoring, recovery, deletion reconciliation and SLOs.
- Product owner: audience/revision UX, history presentation, simulation/production mode separation.
- Provider/telephony/security owner: separate approval for any future non-simulation authority; explicitly outside this package.

## Decision matrix

| Decision area | Status | Basis |
| --- | --- | --- |
| Continue current browser-only offline rehearsal | Conditionally approved | Existing local tests and explicit provider-disabled contracts; no durable mutation or live activity |
| Phase 16 architecture direction | Conditionally approved for further review | Sound separation of audience, consent and simulation in the review drafts; not independently approved |
| Execute Phase 16 SQL/migrations | Rejected for this phase | Explicit task restriction and unresolved Critical/High findings |
| Create proposed tables/RPCs/grants | Not yet reviewed | Requires independent SQL/RLS/ownership review and disposable verification |
| Composite tenant FKs | Not yet reviewed | Candidate SQL exists, but no parser/runtime/concurrency evidence |
| Candidate member SELECT RLS | Not yet reviewed | Draft policy only; no runtime evidence or complete mutation/revoke contract |
| Direct client DML denial | Not yet reviewed | Revokes are commented candidates, not applied or tested |
| Trusted RPC writer boundary | Not yet reviewed | Candidate bodies exist; owner/search path/grants and bypass tests are absent |
| Simulation-only durable runs | Conditionally approved for future implementation | Only after schema/security approval; must remain provider/lease-free |
| Provider-backed campaign runs | Rejected for this package | Requires separate Phase 12F/provider/telephony/LiveKit approval |
| Event append-only/privacy contract | Not yet reviewed | Candidate constraints do not prove immutability or complete metadata safety |
| Retention/deletion behavior | Not yet reviewed | Owner, legal hold, purge, tombstone and reconciliation decisions pending |

## Acceptance-test package

These tests are required after written approval and only in the explicitly authorized disposable environment. They are not permission to execute SQL now.

### 1. Same-tenant foreign-key integrity

- Create two synthetic organizations with separate owners/admins/members.
- Attempt audience-to-campaign mismatch, audience-contact mismatch, run-campaign mismatch, run-audience mismatch, and event-run mismatch.
- Require transactional rejection with no partial assignment/run/event.
- Verify prerequisite composite unique keys and foreign-key error behavior.

### 2. Cross-tenant isolation

- Test member/admin/viewer reads across organizations for audiences, assignments, revisions, runs and events.
- Test forged IDs, selected-organization cookie changes, and mixed parent IDs.
- Require 404/403 or empty tenant-scoped results without existence leakage.

### 3. Role-based permissions

- `anon`: no reads or writes.
- Authenticated non-member: no reads or writes.
- Viewer/member: approved reads only; no audience/run/event mutation.
- Owner/admin: only approved RPC operations in their organization.
- Wrong role/function owner/API executor: direct DML and RPC execution denied.

### 4. Concurrent consent revocation

- Start run creation while a second transaction revokes consent or sets `opted_out_at`.
- Verify the chosen isolation/lock contract produces a blocked/stale result or a committed run whose snapshot was valid before the change, never a run authorized from stale browser data.
- Repeat for multiple contacts and concurrent contact deletion.

### 5. Audience revision conflicts

- Concurrent add/remove with the same expected revision.
- Require one deterministic winner and one stale-revision conflict.
- Verify a run references an immutable revision/hash and is not changed by later audience edits.

### 6. Duplicate/replayed run events

- Replay the same idempotency key/fingerprint and require the original run.
- Reuse the key with a changed campaign, audience, kind or fingerprint and require conflict.
- Replay event sequence/key, attempt gaps/out-of-order events, and attempt duplicate terminal events.
- Require no duplicate or illegal event and no run-state regression.

### 7. Cancellation and emergency stop

- Test draft/queued/running cancellation and all terminal-state rejects.
- Verify simulation cancellation writes only bounded synthetic events.
- Verify emergency stop blocks new work and does not imply provider termination evidence.
- Keep Phase 12F lease/reconciliation tests separate and blocked until that approval exists.

### 8. Retention and deletion

- Verify approved retention expiry purges only eligible run/event data.
- Test organization/campaign/contact deletion against the approved tombstone/cascade policy.
- Verify legal hold prevents purge and deletion is idempotent.
- Detect and reconcile orphaned assignments/revisions/events without exposing raw content.

### 9. Privacy and no-provider activity

- Reject phone, transcript, audio, credential and raw provider payload fields, including encoded/ nested variants under the typed event contract.
- Assert no provider reservations, worker leases, LiveKit rooms, telephony requests, billing rows or external network activity are created by simulation runs.

## Proposed testing sequence

1. Independent review of SQL syntax, prerequisites, keys, constraints, policies, function bodies, owners, search paths and grants.
2. Written approval of the disposable environment, synthetic fixtures, role matrix, test data retention and cleanup boundary.
3. Apply only the approved candidate to a randomized disposable database and capture schema/role/grant evidence.
4. Run negative privilege/RLS tests before functional tests.
5. Run same-tenant, concurrency, idempotency, state, event, cancellation and retention tests.
6. Review logs for secret/raw-contact/event leakage and verify cleanup.
7. Update this matrix with reviewer names, dates, evidence links and GO/NO-GO decisions.
8. Only after all Critical/High findings close, implement tenant-scoped APIs for `simulation` runs.

## Explicit GO/NO-GO gates

### Gate A — Design and ownership

**NO-GO.** Requires named independent database/security, platform, data/privacy, architecture, release and operations reviewers; approved schema/RLS/RPC/grant/retention contracts; and explicit Phase 12F separation.

### Gate B — Disposable database verification

**NO-GO.** Requires Gate A approval, randomized disposable scope, parser/runtime success, negative privilege evidence, same-tenant and concurrency acceptance, and cleanup evidence.

### Gate C — Simulation-only implementation

**CONDITIONALLY GO** only after Gates A and B pass. Enforce `kind = simulation`, no worker/provider/lease path, idempotent transitions/events, stale consent blocking, redacted history, and authenticated browser regression.

### Gate D — Any provider-backed or non-simulation run

**REJECTED by this package.** Requires a separate Phase 12F, provider, LiveKit, telephony, consent, retention, termination-evidence and production-operations approval package.

## Remaining actions

1. Assign named independent reviewers and record dates/evidence locations.
2. Resolve the composite prerequisite keys and audience revision model.
3. Convert candidate RLS/revokes/grants/function ownership into an executable reviewed contract.
4. Specify typed event metadata, append-only enforcement, terminal-event coupling and retention/deletion policy.
5. Decide isolation/locking behavior for consent revocation and concurrent audience edits.
6. Approve idempotency conflict and actor-scope semantics.
7. Authorize or explicitly reject disposable PostgreSQL verification.
8. After acceptance only, implement simulation-only APIs/history UI with no provider authority.
9. Keep provider-backed runs, Phase 12F leases, LiveKit, telephony and production deployment out of scope until separate approval.

## Exact checks performed for this package

- Read AGENTS.md, Phase 16A/16B/16E, Phase 24A, Phase 24B, and the review-only Phase 16 SQL without executing it.
- Static inventory of proposed tables, indexes, RLS policies, RPCs and commented grants/revokes.
- No SQL execution, migration, disposable PostgreSQL, provider, worker lease, LiveKit, telephony, Git staging, commit, push, or synchronization.
- Existing Phase 24B verification remains the latest executed application evidence: TypeScript passed, ESLint passed, Vitest 339 passed/21 skipped, Python tests 74 passed, `git diff --check` passed, and port 3402 returned HTTP 200.
- Final package checks: repository root and active identity confirmed, Git repository readable, this document inspected, `git diff --check` passed, and the active port-3402 demo returned HTTP 200. No unrelated changes were modified.
