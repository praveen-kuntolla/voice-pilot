# Phase 12A.2 — First live-voice approval package

## Dependency and decision status

Phase 12A.2 depends on the review of Phase 12A (PR #42) and the offline
Phase 12A.1 gateway (PR #43). Both remain unmerged and draft. The first live
voice test must not begin until an independent PostgreSQL/Supabase and voice
platform security review is recorded. Review-only migrations 012–019 must be
applied only to a newly randomized disposable database during acceptance; the
established ledger 001–011 and remote Supabase remain unchanged.

## Runtime audit

| Control | Status | Evidence / limitation |
| --- | --- | --- |
| Authentication and organization membership | IMPLEMENTED | Existing protected routes and `currentMembership()` enforce the authenticated tenant boundary. |
| Agent ownership | IMPLEMENTED | Existing agent queries filter by the selected organization. |
| Signed assertion verification | CONTRACT ONLY | `startOfflineVoiceSession()` verifies the signed assertion, but no live route issues or consumes one. |
| PostgreSQL admission transaction | CONTRACT ONLY | The gateway injects `DurableSessionAuthorizationStore`; this branch's tests use `MemoryDurableSessionAuthorizationStore`. |
| Concurrency and usage reservation | CONTRACT ONLY | Policy inputs are fail-closed, but live runtime wiring to the PostgreSQL reservation transaction is not active. |
| Emergency stop | CONTRACT ONLY | The injected policy can deny admission; a live provider disconnect path is not implemented. |
| Worker gateway verification | IMPLEMENTED OFFLINE | Existing signed-admission worker contracts reject invalid or disabled provider requests. |
| Cancellation and idempotent release | IMPLEMENTED OFFLINE | The gateway releases the injected store idempotently; provider-side termination is not verified. |
| Microphone and external providers | BLOCKED | Deliberately disabled; no microphone permission, LiveKit room, provider request, audio, call, or recording is created. |

## Disposable browser-only sandbox requirements

Before a browser-only connectivity test, the owner must approve a separate
sandbox project, one synthetic identity and agent, one concurrent session,
short maximum duration, hard usage/spend ceiling, server-only credentials,
no-recording default, explicit microphone consent, signed admission, durable
replay protection, emergency disconnect, sanitized logs, fixture cleanup, and
a rollback owner. The test must prove no phone numbers or customer data are
reachable and must use a randomized disposable database for any review-only
migrations.

## Production and telephony requirements

Real deployment additionally requires provider-specific webhook/signature
verification, durable distributed replay and usage accounting, provider-side
participant termination, transcript/audio retention policy, secret rotation,
monitoring and alerting, billing reconciliation, calling-hours/consent policy,
rate limits, failure recovery, incident response, and an approved egress
boundary. A browser sandbox approval is not approval for outbound calling.

## Provider proposal (not activated)

For the first isolated browser experiment, use LiveKit as the transport with
separate server-side streaming STT, LLM and TTS adapters behind the existing
provider-neutral contracts. This keeps each failure and usage boundary
observable and preserves the current adapter architecture. Vendor pricing,
retention, supported languages and latency must be rechecked from current
official documentation immediately before approval; no accounts or credentials
are created by this phase.

## Owner decisions required

1. Approve or reject the exact provider stack and sandbox accounts.
2. Approve the credential storage, egress, retention and no-recording policy.
3. Approve the one-session concurrency, duration, usage and spend ceilings.
4. Approve the emergency disconnect and rollback procedure.
5. Assign an independent PostgreSQL/Supabase and voice-platform security reviewer.
6. Approve one bounded browser-only connectivity test; this does not authorize
   telephony, messaging, or production deployment.

## Evidence status

Offline Vitest, Python, TypeScript, ESLint and production-build checks are
available from the Phase 12A.1 head and CI. Authenticated Playwright and
disposable PostgreSQL acceptance are **NOT RUN** for this worktree because the
approved `.local/voicepilot-local-loopback-fixtures.json` and verified local
fixture environment are unavailable. No credentials were invented or exposed.
