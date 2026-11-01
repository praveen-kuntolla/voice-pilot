# Phase 12B Authenticated Acceptance and Security Handoff

## Scope

This document covers the stacked Phase 12B branch based on PR #47 commit
`2db53972464346ae5da469ebd80f3a79caec5f08`. The runtime path is deliberately
offline-only. It does not create LiveKit rooms, request microphone access, call
STT/LLM/TTS providers, place calls, send messages, or persist audio/transcripts.

## Dependency order

`PR #27 → #28 → #29 → #30 → #31 → #32 → #33 → #36 → #38 → #39 → #40 → #46 → #47 → Phase 12B authenticated acceptance`

PR #47 targets `feature/phase-12a4-postgres-adapter-acceptance` and remains a
Draft PR. This branch targets `feature/phase-12b-runtime-readiness`.

## Implemented boundary

- `POST /api/voice-session/offline` requires an authenticated user, an active
  organization membership, an organization-owned agent, explicit microphone
  consent, disposable-runtime flags, a loopback PostgreSQL URL, and a
  server-only admission secret.
- Authorization creation, signed assertion issuance, PostgreSQL consumption,
  tenant-bound reservations, and idempotent release use the reviewed adapter.
- Missing configuration, production mode, database errors, invalid identity,
  and denied policy checks fail closed.
- There is no in-memory fallback and no LiveKit-token fallback in this route.
- `src/app/api/livekit/token/route.ts` remains separately gated by its existing
  LiveKit configuration and was not enabled by this branch.

## Verification matrix

| Control | Status | Evidence or limitation |
| --- | --- | --- |
| Authentication and organization membership | IMPLEMENTED | `currentMembership()` protected route boundary |
| Agent ownership | IMPLEMENTED | Agent query is constrained to selected organization |
| Signed admission | IMPLEMENTED OFFLINE | Existing signed-admission contract and route issuance |
| PostgreSQL authorization consumption | IMPLEMENTED OFFLINE | `PostgresTransactionExecutor` and reviewed SQL adapter |
| Tenant isolation and replay checks | VERIFIED IN PARENT CI | PR #46 disposable Linux acceptance evidence |
| Cancellation and idempotent release | IMPLEMENTED OFFLINE | PostgreSQL release adapter |
| Runtime route against disposable Auth/PostgreSQL | VERIFIED | Exact-head Linux CI run 41294145361 |
| Authenticated Playwright lifecycle | VERIFIED | 1 passed, 0 failed, 1 worker; real browser login, admission, cancellation and DB assertions |
| Disposable PostgreSQL restore and integrity | VERIFIED | Randomized gateway DB restored from disposable Supabase DB; required routines and synthetic org/agent assertions passed |
| Fixture and database teardown | VERIFIED | Synthetic fixtures cleaned, gateway DB dropped and absence checked, Supabase stopped |
| LiveKit room/token creation | DISABLED | Explicitly outside this milestone |
| Microphone, STT, LLM, TTS and audio | DISABLED | No provider requests or audio capture |

## Required disposable acceptance

Before claiming browser acceptance, the owner must restore the previously
approved local files without inventing credentials:

- `.local/supabase-loopback-source/docker/.env`
- `.local/voicepilot-local-loopback-fixtures.json`

The runner must verify the Compose project, loopback-only ports, database
volume, and established migration ledger `001–011` before creating disposable
fixtures. Review-only migrations must be applied only to a newly randomized
disposable database. The full required path is:

`login → protected dashboard → organization/agent authorization → PostgreSQL authorization creation and consumption → reservation → offline session → cancellation → repeated cancellation → release → database-state assertions → cleanup`

Required negative cases are tenant mismatch, expired/revoked admission,
emergency stop, usage/concurrency exhaustion, database outage, and transaction
rollback. Each must use real SQL, not an in-memory substitute.

## Security and privacy review checklist

An independent reviewer must verify:

1. RLS, SECURITY DEFINER privileges, transaction-local actor/organization
   context, search paths, and service-role boundaries.
2. Signed assertion key storage, rotation, expiry, replay and revocation.
3. Tenant/agent binding across Next.js, PostgreSQL and worker boundaries.
4. Concurrency and usage ceilings, including fail-closed database failure.
5. Emergency-stop semantics and the future provider-side disconnect path.
6. Server-only provider credentials, egress controls and sanitized logs.
7. Explicit microphone consent, no-recording default, retention and deletion.
8. Monitoring, rollback, alerting, provider quotas and maximum spend.

Codex and automated CI evidence do not constitute independent human approval.

## Live activation blockers

The first real browser voice test remains **NO-GO** until all of the following
are complete and explicitly approved:

- Disposable authenticated browser-to-PostgreSQL acceptance passes.
- Independent PostgreSQL/Supabase and voice-platform reviews are recorded.
- A provider stack, server-only credentials, egress boundary, retention policy,
  hard duration/usage/spend limits and emergency disconnect are approved.
- LiveKit room authorization and participant termination are tested in the
  separately authorized connectivity environment.
- Provider-specific STT/LLM/TTS failure, interruption and cancellation paths
  are tested without customer data or telephony.

## Exact current verification

PR #48 is OPEN and DRAFT, targets `feature/phase-12b-runtime-readiness`, and
is mergeable at head `5db562a0dd4e87ad2e4f1fe250a202304b684557`. Exact-head
workflow [41294145361](https://github.com/praveen-kuntolla/voice-pilot/actions/runs/41294145361)
passed all four jobs: offline TypeScript/ESLint/Vitest/build, Python worker
tests, synthetic Chromium, and `authenticated-voice-postgres-e2e`.

The authenticated job used an Ubuntu-hosted disposable Supabase stack and a
randomized gateway database. The restore uses an intermediate dump file,
removes only the verified unsupported `log_min_messages` session settings,
excludes only `vault.secrets` data, then asserts the authorization routines and
synthetic organization/agent rows before starting Next.js. Generated secrets,
fixture passwords and service keys were masked in Actions output. Teardown
removed fixtures, dropped and verified the randomized database, and stopped
Supabase successfully.

## Fresh verification on the exact head

- GitHub Actions run 41294145361: **all four jobs passed**.
- Authenticated Playwright: **1 passed / 0 failed / 0 skipped**.
- TypeScript, ESLint, Vitest, production build, Python worker tests and
  synthetic Chromium: **passed in exact-head CI**.
- `git diff --check`: **passed**.

The local Windows worktree was not used to reclassify CI results because its
generated-file writes remain restricted. Push and pull-request runs are
serialized by branch so fixed Supabase loopback ports cannot race; restore,
SQL integrity assertions, test failure and teardown failure are all fatal.

## PR #48 acceptance implementation

PR #48 now contains a distinct `authenticated-voice-postgres-e2e` CI job. It
starts Supabase locally on Ubuntu, creates a randomized gateway database from
the local disposable template after synthetic fixtures are created, starts the
real Next.js application, and runs a mandatory Playwright test. Cleanup stops
the server, drops the gateway database, removes synthetic Auth users and stops
Supabase. Missing fixture/configuration causes failure rather than a skipped
pass.

The browser test verifies login, explicit-consent rejection, authenticated
offline admission, simulation-only/no-recording response, cancellation,
idempotent repeated cancellation, and persisted PostgreSQL consumed/released
state. It does not request microphone access or contact any provider.

The test also exposed and corrected a contract defect: the start response now
returns the `assertionId` required by the cancellation endpoint.

The Linux CI install initially failed because the Windows-only Next SWC binary
was declared as a mandatory dependency. It is now an optional platform-specific
dependency, so `npm ci` can install the locked graph on Ubuntu while Windows
continues to receive the optimized binary.

## Control evidence classification

| Control | Classification | Human review question |
| --- | --- | --- |
| Authenticated membership and agent ownership | VERIFIED offline | Are all production entry points equally protected? |
| Signed admission and tenant binding | VERIFIED offline / partially durable | Are key rotation, clock handling and worker deployment boundaries approved? |
| PostgreSQL authorization, reservation and idempotent release | VERIFIED in disposable CI | Are migrations, privileges, RLS and rollback suitable for the intended production role? |
| CI dump/restore isolation and secret masking | VERIFIED in exact-head CI | Does the reviewer accept the `vault.secrets` data exclusion and dump-derived privilege model? |
| Emergency stop | PARTIALLY VERIFIED | What provider-side disconnect is authoritative after a live session starts? |
| Usage/concurrency ceilings | PARTIALLY VERIFIED | Are provider billing reconciliation and hard spend enforcement independently proven? |
| Browser-to-PostgreSQL offline lifecycle | VERIFIED | Does the reviewer accept the single synthetic-session scope as sufficient evidence? |
| LiveKit/STT/LLM/TTS connectivity | NOT VERIFIED | Which provider stack and retention terms are approved? |
| Audio/transcript retention | REQUIRES HUMAN REVIEW | Is no-recording the default, and who owns deletion/exception handling? |
| Production operations and rollback | REQUIRES HUMAN REVIEW | Who can stop, drain, reconcile and roll back the live sandbox? |

## Independent reviewer assignments

PR #48 currently has no submitted reviews. The owner should nominate:

1. **PostgreSQL/Supabase security reviewer** — migrations 017–019, RLS,
   `SECURITY DEFINER`, `search_path`, service-role privileges, tenant context,
   replay/expiry and transaction rollback.
2. **LiveKit/voice-platform security reviewer** — room admission, participant
   termination, worker identity, interruption, provider outage and emergency
   disconnect.
3. **Privacy/retention owner** — microphone consent, no-recording default,
   transcript/audio retention, deletion and provider terms.
4. **Operations/emergency-stop owner** — monitoring, alerting, credential
   rotation, stop authority, cleanup and rollback runbook.
5. **Billing/spend owner** — provider quotas, three-minute cap, one-session
   concurrency, usage reconciliation and maximum spend.
6. **Project owner** — provider selection, test identity, egress, dates,
   approvals and final GO decision.

## First browser voice experiment approval envelope

The proposed experiment is browser-only and synthetic: one authorized test user,
one synthetic agent, one concurrent session, a three-minute hard limit, explicit
microphone consent, no recording by default, server-only credentials,
provider-specific spend caps, durable usage reconciliation, monitoring and an
emergency disconnect test. LiveKit transport and separate STT/LLM/TTS providers
remain a proposal; no account, key, room or microphone path is enabled by PR #48.

Before activation, the owner must approve provider selection and pricing,
credential storage and rotation, network egress, retention/deletion policy,
provider quotas, emergency disconnect and rollback owners, and the exact
synthetic identity. Independent PostgreSQL and voice-platform reviewers must
record approval. Until then the decision is **NO-GO**.

## Browser voice integration preparation

The stacked browser-voice preparation branch adds a server-only browser-session
boundary and an explicit activation envelope. The browser control is visibly
disabled, does not request microphone permission, and does not contact LiveKit
while the envelope is disabled. Future token issuance requires all of
`VOICE_BROWSER_VOICE_SESSION_ENABLED`, `VOICE_PROVIDER_ACTIVATION_ENABLED` and
`VOICE_REALTIME_ENABLED` to be explicitly true, while outbound calling and
recording remain false. Authentication, organization membership and agent
ownership are checked before any future issuance path.

The disconnect controller is an offline orchestration contract only. It orders
worker cancellation, participant removal, room closure, admission revocation,
usage reconciliation and reservation release, and is idempotent. Provider-side
termination, microphone behavior, audio retention, spend enforcement and live
failure handling remain unverified and require independent human approval in a
separate disposable connectivity environment.
