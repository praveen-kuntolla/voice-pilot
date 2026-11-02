# Phase 24B — Durable campaign-run foundation readiness

Status: **REVIEW ONLY / NOT IMPLEMENTATION AUTHORIZATION**. No Phase 16 SQL, migration, database object, RPC, worker lease, provider, or production campaign-run path was executed or added.

## Executive finding

The current campaign implementation is a tenant-scoped configuration and offline rehearsal surface. `campaigns` and `contacts` are persisted, but audience selection is an in-memory session set, readiness is a fresh server preflight, and simulation events are local/browser synthetic activity. There is no durable audience snapshot, run identity, event ledger, scheduler, queue, or trusted campaign-run writer.

Phase 16 is directionally compatible with the current safety boundary, but it is not yet an approved or executable production contract. The most important prerequisite is to approve the composite tenant-key/RLS/RPC/grant model and prove it against disposable PostgreSQL concurrency and negative-privilege tests before implementing any durable run API.

## Architecture reconciliation

| Concern | Current implementation | Phase 16 proposal | Reconciliation finding |
| --- | --- | --- | --- |
| Campaign configuration | Tenant-scoped `campaigns`; owner/admin server writes; member reads | Parent of audience and runs | Compatible, but campaign/agent same-tenant enforcement must remain database-backed and API-backed |
| Audience membership | Organization contact pool; session-local checkbox selection | Versioned named `campaign_audiences` plus assignment/removal history | Required new capability; browser selection is not durable authorization |
| Audience revision | None | Revision/version and snapshot semantics | Required to make runs reproducible and stale-writer safe |
| Consent | `consent_status`, `opted_out_at`; preflight rechecks current values | Recheck at run creation and execution; stale run becomes blocked | Must be transactional at durable run creation and before every future dispatch |
| Simulation run | `MockCampaignSimulation` in memory; synthetic tab activity | Durable `campaign_runs` with `kind = simulation` initially | Phase 24B can safely implement simulation persistence only after schema approval |
| Events | Local synthetic events and redacted browser exports | Append-only bounded `campaign_run_events` | Event schema, privacy, immutability, and direct-write denial require SQL/RLS approval |
| Authorization | `currentMembership`, API organization predicates, campaign simulation preflight | Trusted writer/RPC derives actor and organization | Existing API boundary is not sufficient for concurrent durable transitions |
| Idempotency | No durable campaign-run idempotency key | Run creation fingerprint/key and conflict semantics | Must be defined before API implementation |
| Concurrency | No persistent audience/run writers | Locks/version predicates and deterministic lock order | Must be proven with disposable PostgreSQL tests, not inferred from browser behavior |
| History | No durable campaign history; Calls/Analytics are synthetic | Tenant-scoped run/event history | New UI should distinguish simulation history from production call history |
| Retention/deletion | Campaign/contact deletion only affects current baseline rows; tab activity can be cleared | Bounded run/event retention and deletion policy | Requires data owner approval, audit policy, and cascade/tombstone decision |

## Required logical data contract

The following is a design checklist, not executable SQL. Any implementation must remain additive, idempotent, review-only until explicit approval.

### Campaign audiences

An audience needs a tenant-bound identity, campaign parent, name, lifecycle state, creator, revision/version, created/updated timestamps, and optional retention metadata. The campaign-to-audience relationship must include organization identity in the key path. An audience should be immutable once used by a run, with later changes creating a new revision or version rather than silently mutating a run’s input.

### Audience contacts

Each active membership needs organization ID, audience ID, contact ID, assignment actor, assignment/removal timestamps, and an immutable membership revision or version. Enforce same-tenant audience/contact relationships with composite foreign keys or an equivalent trusted constraint. Preserve removal history without allowing duplicate active membership. Contact deletion, organization deletion, and audience deletion need explicit cascade/tombstone semantics.

### Durable runs

Each run needs organization ID, campaign ID, audience ID/version, kind (`simulation` only for the first phase), state, actor, idempotency key, input fingerprint, snapshot time, expected version, created/updated/completed timestamps, and bounded retention metadata. Run creation must capture the audience and consent snapshot needed for reproducibility without treating that snapshot as permission to dispatch later.

Suggested simulation states are `preparing`, `ready`, `running`, `paused`, `completed`, `failed`, `cancelled`, `blocked`, and `stale`. Terminal transitions must be one-way. A simulation run must never create a provider reservation, room, call, message, billing event, or customer-facing record.

### Immutable run events

Events need organization ID, run ID, sequence or monotonic event number, event type, bounded redacted metadata, actor/worker source, event time, and an idempotency/event key. The database must reject updates/deletes and duplicate keys, and direct client inserts must be denied. Do not store phone numbers, transcripts, audio, credentials, raw provider payloads, or unrestricted contact metadata.

## Security review

### Same-tenant keys and RLS

Repeated `organization_id` columns are not enough. The proposed audience/contact/run/event relationships need composite uniqueness and foreign-key paths that make cross-tenant references impossible or fail transactionally. RLS must deny cross-tenant reads and direct client writes. Member reads should be limited to approved history fields; mutation should occur through tightly scoped server/RPC paths.

The exact database role ownership, `SECURITY DEFINER` search paths, function owners, grants, inheritance, pooler behavior, and service-role bypass model remain approval items. Phase 16 documentation explicitly says these are not verified.

### Trusted writers and worker boundaries

The browser may request a run but cannot choose the authoritative organization, actor, audience revision, consent state, state transition, event sequence, or provider kind. A trusted server writer or reviewed RPC must derive actor and organization from the authenticated context, verify campaign/audience/contact/agent relationships, and write the run plus initial event transactionally.

No Phase 12F worker lease implementation is part of this phase. If a later worker consumes simulation runs, it needs a separate least-privilege identity, signed job/lease contract, bounded claim/retry rules, and no provider authority. A simulation writer must not inherit production provider or reconciliation privileges.

### Transactional consent validation

At durable run creation, lock or version-check the campaign, audience revision, assigned agent, and selected contacts in deterministic order. Revalidate `consent_status = 'granted'`, `opted_out_at IS NULL`, organization identity, campaign state, agent status, and consent-required policy in the same transaction that creates the run. A mismatch must fail or create `blocked/stale`; it must never silently refresh the audience.

Before any future non-simulation dispatch, repeat the check immediately before provider admission. A browser readiness response, old run snapshot, or cached contact list is never execution authority.

### Concurrent audience modification

Define whether an audience edit creates a new revision, blocks active runs, or is prohibited after run creation. The safe default is immutable revisions: new membership changes create a new version, and an existing run remains tied to its captured version. Use expected-version predicates and deterministic locks to reject stale writers. Acceptance must cover concurrent add/remove, consent revoke during creation, campaign archive during creation, and duplicate assignment attempts.

### Replay and duplicate protection

Run creation requires a tenant/actor/campaign/audience-bound idempotency key plus a canonical input fingerprint. An exact retry returns the original run; the same key with different parents or content returns a conflict. Event insertion requires a unique tenant/run/event key and expected sequence/version. Do not use browser timestamps or random client IDs as the only replay defense.

### Emergency stop and cancellation

Simulation runs may support cancellation and pause without provider side effects. Any future provider-backed transition must check organization/global emergency stops before new work and define what cancellation means for already-claimed work. Phase 12F approval is required before coupling run transitions to worker leases, reservations, termination evidence, or release/reconciliation.

### Least-privilege RPC grants

The intended client role should have no direct DML on audience/run/event tables. Approved RPCs should expose only the operations needed by the product: create audience revision, manage membership, create simulation run, transition run, append bounded event, read tenant history, and request deletion/retention handling. Function search paths, owners, execute grants, actor binding, and direct-table denial require independent review and negative tests.

### Run-event privacy

Events must be bounded by type, size, count, and retention. Metadata should be an allowlisted structure, not arbitrary JSON from the browser. Redact contact identifiers and keep any UI-facing contact display data behind tenant-scoped reads. Do not treat simulation event storage as a transcript or call-record system.

## Retention and deletion requirements

- Define separate retention for audience membership history, run headers, run events, audit evidence, and any future provider artifacts.
- Decide whether campaign/contact deletion tombstones or cascades run history; preserve only the minimum approved audit evidence.
- Delete or anonymize run/event data on organization deletion according to the approved retention/legal-hold policy.
- Make deletion idempotent and observable without exposing raw event payloads.
- Add reconciliation for orphaned audiences, runs, events, and stale transition leases only after the operator role and Phase 12F boundary are approved.

## Review-only implementation sequence

### A. Schema and security gates

Approve the Phase 16 logical schema, composite tenant keys, RLS policies, direct-table revokes, RPC contracts, function ownership/search paths, retention, audit/event privacy, and simulation-only feature flag. Resolve every Critical/High finding in the Phase 16 review and obtain explicit database/security approval.

### B. Disposable PostgreSQL concurrency acceptance

Only after written approval, run the draft contract against a randomized disposable database—not the project’s approved local baseline—covering cross-tenant denial, role/grant denial, duplicate active membership, stale audience version, concurrent run creation, consent revoke races, idempotent retry/conflict, terminal transition denial, immutable events, and cleanup. This phase is not authorized in the current task.

### C. Tenant-scoped APIs

Implement server routes/RPC clients only after the schema passes review. APIs must derive tenant/actor context server-side, expose simulation kind explicitly, require idempotency, return sanitized run/event data, and deny member mutations not granted by the role matrix. Browser inputs must never supply authoritative organization or consent claims.

### D. Durable offline simulation runs

Persist only `kind = simulation`. Reuse the existing readiness and deterministic simulation contracts, but make the run’s audience revision and consent snapshot explicit. Every transition must revalidate the run version and append one immutable bounded event. Keep provider, LiveKit, telephony, billing, and customer-record writes impossible by construction.

### E. Campaign history UI

Add a tenant-scoped simulation-history view with run state, timestamps, audience revision, counts, sanitized event timeline, stale/blocked reason, retry/cancel affordances, and clear simulation-only labeling. Do not place durable simulation events under a production Calls label without a distinct mode boundary.

### F. Browser regression and recovery testing

Add authenticated tests for owner/admin/member role boundaries, cross-tenant IDs, duplicate idempotency, stale consent, concurrent-edit behavior through test harnesses, refresh/navigation recovery, cancellation, terminal-state behavior, event privacy, deletion, and no provider/network activity. Existing browser journeys should continue to prove that no live action controls appear.

## Approval checklist

- [ ] Phase 16 schema and composite tenant-key design approved.
- [ ] RLS, direct-table revokes, RPC grants, function ownership and search paths approved.
- [ ] Phase 12F dependency boundary explicitly approved or excluded for simulation-only work.
- [ ] Audience revision and mutation semantics approved.
- [ ] Consent race and stale-run behavior approved.
- [ ] Idempotency/fingerprint and event duplicate semantics approved.
- [ ] Run state machine, cancellation, emergency stop and terminal transitions approved.
- [ ] Event fields, redaction, limits, retention and deletion policy approved.
- [ ] Disposable PostgreSQL concurrency/privilege suite authorized and passes.
- [ ] Tenant-scoped API and browser regression suite passes with no provider activity.
- [ ] Separate approval exists before any provider, worker lease, LiveKit, telephony, or non-simulation run authority is enabled.

## Remaining blockers

The Phase 16 SQL and objects are explicitly review-only. RLS/grants/RPC ownership, PostgreSQL parser/runtime verification, concurrency tests, retention/deletion decisions, Phase 12F worker authority, and provider-backed execution approvals remain outstanding. Therefore no durable campaign-run implementation should be started against the current database in this phase.

## Verification performed for this review

- Read-only inspection of AGENTS.md, Phase 24A, Phase 16A/16B/16E, campaign APIs, readiness, simulation lifecycle, and authorization contracts.
- TypeScript: passed.
- ESLint: passed.
- Full Vitest: 339 passed, 21 skipped.
- Python worker tests: 74 passed.
- `git diff --check`: passed.
- Port 3402 health: HTTP 200.
- No SQL, migration, database, provider, worker lease, LiveKit, telephony, or external service operation was executed.
