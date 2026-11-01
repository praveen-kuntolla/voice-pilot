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
| Runtime route against disposable Auth/PostgreSQL | NOT VERIFIED HERE | Approved fixture metadata unavailable |
| Authenticated Playwright lifecycle | NOT RUN | `.local/voicepilot-local-loopback-fixtures.json` absent |
| Disposable PostgreSQL rerun | NOT RUN | Docker CLI unavailable; no safe target could be established |
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

## Exact current blocker

At the time of this handoff, the worktree contains no approved fixture metadata
and the `docker` executable is unavailable. Authenticated Playwright and fresh
disposable PostgreSQL acceptance are therefore **NOT RUN**, not passed.

## Fresh local checks on this branch

- Python worker tests: **67 passed** from `workers/voice-agent`.
- ESLint: **passed**.
- Vitest: **NOT VERIFIED** in this worktree because the sandbox denied creation
  of `node_modules/.vitest-cache`; the parent branch's applicable result was
  293 passed / 21 skipped.
- TypeScript: **NOT VERIFIED** because the sandbox denied writing the existing
  `tsconfig.tsbuildinfo`; the parent branch's applicable result was passed.
- Production build: **NOT VERIFIED** because the sandbox denied creating the
  Next.js build directory; the parent branch's applicable result was passed.
- `git diff --check`: **passed**.

The workflow trigger was extended for the Phase 12B stacked base and this
acceptance branch. It does not silently claim authenticated acceptance: that
job still requires approved disposable Auth/PostgreSQL fixtures and must be
added or run only once that environment can be verified.

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
