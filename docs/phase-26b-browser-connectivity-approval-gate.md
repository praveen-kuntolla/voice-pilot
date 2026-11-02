# Phase 26B — Browser connectivity approval gate and test preparation

Status: **prepared, not approved, not executed**. This package does not create a LiveKit room, issue a real access token, request microphone permission, activate an AI provider, connect telephony, execute SQL, or implement Phase 12F/16.

## Decision gate

The current decision remains **NO-GO**. One disposable browser-connectivity session may begin only after the following written authorization is recorded by named owners:

| Required approval | Minimum evidence | Status |
| --- | --- | --- |
| Voice platform owner | Dedicated isolated LiveKit test project, project host, room/participant cleanup authority and provider-side termination procedure | Pending |
| Database/security owner | Phase 12F worker-admission contract accepted for this test, least-privilege roles, replay/rate-limit boundary and no production database access | Pending; Phase 12F remains review-only |
| Platform/security owner | Secret-manager references, worker-key rotation/revocation, egress allowlist and browser-token review | Pending |
| SRE/release owner | One-session concurrency, maximum duration, spend ceiling, monitoring, rollback and cleanup owner | Pending |
| Privacy/compliance owner | Synthetic identity only, no recording, no customer data, no external AI processing and retention/cleanup confirmation | Pending |
| Product/safety owner | Explicit start/stop controls, emergency shutdown and confirmation that this is not telephony or campaign execution | Pending |

Approval must identify the exact environment, test account/tenant, credential references (not secret values), start/stop operator, expiry time, budget ceiling, expected evidence and rollback owner. Approval for this test would not authorize STT/LLM/TTS, outbound calls, SIP, production deployment or durable campaign runs.

## Current safety boundary

The browser-session API is disabled unless all of its future activation conditions are met: browser-session activation, provider activation and realtime flags must be enabled, outbound and recording must remain disabled, and durable admission must be wired. The worker endpoint separately requires its feature flag, signed timestamp/nonce request, replay/rate protection, room/tenant/agent binding and single-use room authorization.

The existing token route can produce a connectivity-mode room-scoped token only when explicitly configured with the isolated test values. That path is not being called here. The current application-level termination route only revokes the local authorization tombstone; it does not revoke an already-issued LiveKit JWT or remove an active remote participant. Provider-side stop authority is therefore a prerequisite, not an assumption.

## Non-executing acceptance matrix

The following tests are prepared as contract/route tests. They use mocked membership, mocked Supabase queries, fake rooms, deterministic flags and synthetic UUIDs. They must remain offline until the approval record above exists.

| Area | Prepared assertion | Existing seam/test | Execution status |
| --- | --- | --- | --- |
| Disabled browser endpoint | `POST /api/livekit/browser-session` returns 503 and no token when activation or durable admission is disabled | `browserVoiceSessionRequestSchema`, `isBrowserVoiceActivationEnabled`, route seam | Prepared; not executed in this phase |
| Anonymous denial | Anonymous token and browser-session requests return 401 before any room/token work | `tests/livekit-route.test.ts`; authenticated browser security spec | Existing mock/unit coverage; not rerun here |
| Tenant authorization | Foreign agent, forged organization or mismatched room is rejected; no authorization store mutation is accepted | `tests/livekit-route.test.ts`, `tests/livekit-room-auth.test.ts` | Existing mock/unit coverage; not rerun here |
| Token lifetime and scope | Connectivity token is five minutes, exact room scope, `canPublish=false`, `canPublishData=false`, no room-admin/create grant | `tests/livekit.test.ts`, `tests/livekit-route.test.ts` | Existing mock/unit coverage; not rerun here |
| Client-selected session | Client-supplied session ID is rejected; server creates an unpredictable session/room identity | `tests/livekit-route.test.ts` | Existing mock/unit coverage; not rerun here |
| One-session admission | Exact room authorization consumes once; replay, wrong tenant, wrong agent and second consumption fail closed | `tests/livekit-room-auth.test.ts`; future durable Phase 12F matrix | Mock store prepared; disposable DB not authorized |
| Browser lifecycle | Disabled session never connects or requests media; fake-room connect/disconnect, failure cleanup and pre-connect microphone denial are deterministic | `tests/livekit-browser-session.test.ts` | Existing fake-room coverage; not rerun here |
| Emergency shutdown | Stop blocks new admission; disconnect calls worker cancel, participant removal, room close, authorization revoke, usage reconciliation and reservation release in order | `BrowserVoiceDisconnectController`; `src/lib/durable-safety.ts` seams | Contract tests prepared; provider-side stop unavailable |
| Cleanup and recovery | Failed cleanup remains `termination_unconfirmed`/`awaiting_reconciliation`; no capacity release occurs while termination is uncertain | `BrowserVoiceDisconnectController` | Mock-only preparation |
| Credential handling | No secret-like `NEXT_PUBLIC_*` value, remote Supabase URL, non-loopback endpoint or activation flag passes test preflight | `tests/livekit-test-preflight.test.ts`, `scripts/check-livekit-test-config.mjs` | Existing static coverage; not rerun here |
| No-audio boundary | No microphone permission, audio publication, recording, provider request, phone number, billing row or customer data is created by the preparation suite | fake room and disabled session seams | Must be asserted by approved test telemetry/log review |

## Minimal post-approval changes

No application change is authorized now. After approval, the smallest implementation delta should be:

1. Add a test-only runner configuration that reads private loopback/test values, verifies the exact project host and keeps `VOICE_PROVIDER_MODE=mock`, `VOICE_OUTBOUND_ENABLED=false`, recording disabled and all provider flags off.
2. Add a browser test using a fake or approved isolated LiveKit room seam; do not add microphone capture or provider adapters to the first run.
3. Wire only the approved durable admission/release boundary. Do not execute review-only Phase 12F SQL until its owner signs off on corrected SQL, grants, roles and acceptance evidence.
4. Add explicit bounded start/stop controls and a watchdog that stops the test at the approved duration; fail closed if cleanup or accounting is unavailable.
5. Capture sanitized evidence: actor/tenant/agent binding, room/session IDs as non-sensitive test identifiers, timestamps, state transitions, cleanup result and zero provider/telephony/recording side effects.
6. Revoke test credentials and remove only test-owned rooms, reservations, fixtures and logs after evidence review.

## Test environment and secret boundary

- Use only a newly approved isolated LiveKit project and loopback/disposable Supabase fixture environment.
- Keep LiveKit API secrets, worker shared secrets and Supabase service-role credentials server/worker-side or in an approved secret manager. Never put them in browser bundles, `NEXT_PUBLIC_*` variables, fixtures, screenshots or logs.
- Use one synthetic organization, one synthetic user, one synthetic agent and no phone numbers, recordings or customer content.
- Pin the project host and reject redirects, arbitrary room names, remote Supabase URLs and mismatched public/private project values.
- Use separate test credentials with short expiry, rotation and immediate revocation after the run.

## Explicit controls

| Control | Required value for first test |
| --- | --- |
| Concurrent sessions | 1 |
| Maximum session duration | Short, owner-approved hard timeout |
| Provider mode | `mock` |
| STT/LLM/TTS requests | 0 |
| Outbound/SIP/telephony | Disabled |
| Recording | Disabled |
| Browser publication | Disabled for connectivity acceptance; no microphone permission |
| Spend ceiling | 0 external AI/telephony spend; only separately approved infrastructure cost |
| Start | Manual named operator after approval check |
| Stop | Manual stop plus watchdog, emergency denial and cleanup verification |
| Rollback | Disable flags, revoke credentials, terminate test resources, reconcile reservations |

## Failure recovery requirements

The test must stop new admission on any signature, nonce, tenant, participant, timeout, accounting, cleanup or provider-state uncertainty. An uncertain room or worker must not release capacity based on a client or worker assertion. The approved reconciliation operator must verify termination evidence before release. If the isolated project, secret store, security store or database is unavailable, the test reports blocked/failed closed and does not retry indefinitely.

## What remains blocked

- Real LiveKit connection and room creation until all approvals above are recorded.
- Microphone permission and browser audio publication.
- STT, LLM and TTS activation or provider credentials.
- Phase 12F worker leases, migrations, durable reconciliation and production termination evidence.
- SIP/telephony, outbound calls, messaging and recording.
- Phase 16 persistent campaign audiences/runs and any campaign dispatcher.
- Production deployment, customer data and billing integration.

## Verification record for this preparation

- Read `AGENTS.md` and reviewed `docs/phase-26a-live-voice-integration-readiness.md`.
- Inspected browser-session, LiveKit token/termination, worker-config, provider flag, authorization, synthetic fixture and existing mock browser/unit test infrastructure.
- Prepared this acceptance matrix against existing test seams; no connectivity test was executed.
- No LiveKit resource, token, microphone, provider, telephony, SQL, migration, worker lease, Git staging, commit, push or synchronization was performed.
