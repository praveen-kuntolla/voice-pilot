# Phase 12C — Trusted Worker Reservation Lifecycle Design

Status: review-only architecture proposal. No runtime endpoint, migration, provider, LiveKit room, microphone, or worker activation is enabled by this document.

## 1. Existing architecture

### Browser admission and room authorization

The authenticated browser boundary is represented by `src/app/api/livekit/browser-session/route.ts`. It uses `currentMembership()` from `src/lib/authz.ts`, checks the selected agent through the current organization, requires `isBrowserVoiceActivationEnabled()` from `src/lib/browser-voice-session.ts`, and requires explicit `microphone_consent: true` through `browserVoiceSessionRequestSchema`.

When enabled, the route creates a tenant-scoped room with `voiceRoomName()` from `src/lib/livekit.ts`, issues a short-lived LiveKit token with `createLiveKitToken()`, and records room authorization with `registerIssuedRoom()` from `src/lib/livekit-room-auth.ts`. The route is disabled by default and does not itself create a durable PostgreSQL voice-session reservation.

The existing browser controller is `src/lib/livekit-browser-session.ts`. It uses the LiveKit `Room` SDK, requires a server-issued `{ url, token, room, sessionId }` envelope, serializes transitions, requires an authorized connected state before microphone enablement, and cleans up room events and local tracks. Its default activation remains disabled.

### Durable PostgreSQL voice-session authorization

The offline, disposable admission path is in `src/app/api/voice-session/offline/route.ts` and `src/lib/postgres-voice-session-gateway.ts`:

- `createPostgresVoiceAuthorization()` calls `public.create_voice_session_authorization()`.
- `startPostgresVoiceSession()` validates the signed admission, tenant/agent/actor/session bindings, emergency-stop and usage policy, then calls `public.consume_voice_session_authorization()`.
- `releasePostgresVoiceSession()` calls `public.release_voice_session_authorization(session_id, organization_id, actor_id)`.
- The browser `DELETE` route releases an offline session after authenticated membership and agent checks.

The relevant schema is `public.voice_session_authorizations` and its audit table `public.voice_session_audit_events`, defined/hardened by migrations `202610220017_durable_session_authorization.sql` and `202610220018_transactional_session_admission.sql`. The release RPC requires request-local `request.jwt.claim.sub` to equal `p_actor_id` and `voicepilot.organization_id` to equal `p_organization_id`; it updates only the matching unreleased row and writes a `released` audit event. A repeated release returns false without changing another row.

Separate provider-governance reservations are defined in `public.provider_action_reservations` and `voicepilot_safety.provider_usage_reservations` by migrations `202610220012` through `202610220019`. These enforce concurrency, usage and emergency-stop policy through server-side transaction functions. They are not currently connected to the LiveKit browser route.

### Signed worker configuration

The worker calls `fetch_runtime_config()` in `workers/voice-agent/voice_agent/service_client.py`. It signs a canonical request containing method, path, timestamp, nonce and exact JSON body with `VOICE_WORKER_SHARED_SECRET`.

`src/app/api/internal/voice-agent/config/route.ts` verifies the HMAC with `verifyWorkerRequest()` from `src/lib/worker-auth.ts`, checks nonce uniqueness and timestamp bounds through the configured voice security store, validates the room identity, verifies organization/agent ownership with a server-side client, and consumes the issued room authorization. It returns minimal runtime data including organization, agent, session expiry and the authorized browser identity.

The worker validates room identity and tenant binding in `workers/voice-agent/voice_agent/worker.py`. `validate_agent_identity()` runs before provider construction. `build_agent_session()` wires adapters into the LiveKit `AgentSession` shape, while `run_agent_session()` closes the session and requires a reservation-releaser callback in every exit path. Realtime startup currently fails closed when that callback is absent.

### Cancellation, emergency stop and disposable restrictions

`src/lib/browser-voice-session.ts` defines ordered offline disconnect orchestration: cancel worker, remove participant, close room, revoke admission, reconcile usage, and release reservations. It is a contract only; it does not call LiveKit or providers.

`workers/voice-agent/voice_agent/connectivity_lifecycle.py` handles participant departure, expiry, room disconnect and cleanup for the mock connectivity path. The offline PostgreSQL route is explicitly guarded by `VOICE_SESSION_POSTGRES_DISPOSABLE=true`, `VOICE_OFFLINE_ADMISSION_TEST_ENABLED=true`, non-production mode and a disposable database URL. These restrictions must remain until a separate production database gateway is approved.

## 2. Proposed complete lifecycle

```text
Authenticated browser
  -> currentMembership + organization-owned agent
  -> server-side durable authorization/reservation
  -> tenant/session-bound room authorization and token
  -> signed worker config request
  -> server consumes room authorization and returns minimal runtime identity
  -> worker validates room, tenant, session, actor and participant identity
  -> AgentSession starts with approved adapters/VAD/turn detection
  -> provider/media cleanup and participant/room termination
  -> signed worker release request
  -> server derives authoritative actor/org/agent/session row
  -> request-local claims + release RPC
  -> durable audit/reconciliation
```

The immutable binding is:

| Identity | Required binding |
|---|---|
| organization | authenticated membership, room name, authorization row, request-local claim |
| agent | organization-owned agent row, room name, authorization row |
| actor | authenticated browser user and authorization row; never unsigned worker input |
| session | server-generated UUID, room suffix, authorization row, release request |
| room | `voicepilot:<organization>:<agent>:<session>` and server-issued token |
| participant | LiveKit participant identity equal to the authorized actor/browser identity |

The proposed production path must create the durable authorization and provider/concurrency reservation atomically before token issuance. A token or room must never be issued when reservation creation is unavailable.

## 3. Trusted release transport proposal

### Request

Use the existing worker HMAC mechanism with a new narrowly scoped path, for example:

`POST /api/internal/voice-agent/release`

The signed body should contain only the room name and a release reason:

```json
{"room_name":"voicepilot:<org>:<agent>:<session>","reason":"completed|failed|cancelled|emergency_stop|expired"}
```

The body is integrity-protected but is not authoritative for actor, organization or agent identity. The server must parse the room, look up the authorization row by session and organization, verify the stored agent and actor, and derive the actor from that row.

The canonical signature remains:

```text
POST
/api/internal/voice-agent/release
<timestamp>
<nonce>
<exact-json-body>
```

`verifyWorkerRequest()` must enforce the existing five-minute timestamp window, nonce length, HMAC comparison and single-use nonce. Release requests must use a distinct rate-limit key and a maximum body size. The endpoint must reject requests when worker activation, durable gateway configuration or replay protection is unavailable.

### Server-side release sequence

1. Verify HMAC, timestamp and nonce before parsing business fields.
2. Parse and strictly validate the room name and reason.
3. Load the authoritative authorization/reservation row using a server-side service client or transaction executor.
4. Verify organization, agent, session, actor and reservation ownership from the row; never accept actor identity from the body.
5. Establish request-local organization and actor claims in the same transaction used for release.
6. Call the existing release RPC or a reviewed production gateway wrapper around it.
7. Record a minimized audit event containing action, authorization ID, organization ID, session ID, reason and correlation ID; never log tokens, secrets, audio or transcripts.
8. Return an idempotent result: `released`, `already_released`, or a non-authorizing failure. A failure must not free concurrency capacity.

The first implementation must not reuse the current `disposableEnvironment` guard for production. It needs a separately reviewed production gateway configuration, least-privileged service-role execution, statement timeout, transaction rollback handling and connection release.

### Worker behavior

After provider/media cleanup, the worker calls the release endpoint. It retries only transient transport failures with bounded exponential backoff and the same logical release identity. Because each attempt must use a fresh nonce, the worker needs a release-attempt nonce per request while keeping the session/room identity constant.

The worker treats `released` and `already_released` as success. It treats authorization mismatch, replay, expired signature, or server validation failure as terminal and does not retry with changed identifiers. If release cannot be confirmed, the worker must not start another session under the same reservation and must emit a sanitized reconciliation alert.

## 4. Crash, expiry and reconciliation

The database must enforce an expiration timestamp on every reservation. A scheduled or operator-triggered reconciliation job must mark expired active reservations and reconcile usage. Expiry is not permission to release a different session: cleanup must match the exact authorization ID/session/organization/actor row.

Recommended states are `created`, `consumed`, `releasing`, `released`, `expired`, and `reconciliation_required`. State transitions must be monotonic and idempotent. A worker crash after consumption leaves the row bounded by expiry; a crash after provider cleanup but before release is repaired by expiry/reconciliation. A crash during release is safe because the transaction either commits once or the retry observes the released state.

Emergency stop must first prevent new admissions and provider work. The server-side emergency-stop path must terminate or revoke the authorized participant/room where supported, then release the exact durable reservation and reconcile usage. Provider termination failure must not silently release a reservation while media may remain active; it must enter `reconciliation_required` and alert an operator.

## 5. Threat model

| Threat | Required defense |
|---|---|
| Cross-tenant release | Parse room; compare organization/agent/session to authoritative row and request-local claims |
| Forged body actor | Ignore body actor; derive actor from authorization row |
| Forged worker request | HMAC, bounded timestamp, secret rotation and single-use nonce |
| Replay | Nonce store keyed by worker/path/nonce with atomic consume |
| Session substitution | Server-generated room/session mapping and exact row lookup |
| Duplicate callback | Idempotent release state transition |
| Stolen worker secret | Narrow endpoint scope, rate limits, rotation, audit and emergency revocation |
| Provider termination failure | Do not mark fully released until termination/reconciliation policy is satisfied |
| Release race | Transactional row lock/state transition and provider reservation lock |
| Concurrency bypass | Release only the exact active reservation; failed release retains capacity until expiry/reconciliation |
| Worker crash | Reservation expiry plus reconciliation, not client-side cleanup alone |

## 6. New work versus existing mechanisms

Already implemented:

- authenticated membership and tenant agent checks;
- room identity validation;
- HMAC worker authentication, timestamps and nonce replay protection;
- PostgreSQL authorization/release RPCs and audit rows;
- offline idempotent cancellation path;
- browser SDK cleanup and worker AgentSession cleanup seam;
- provider-disabled and connectivity-test gates.

Required before production approval:

1. A production-enabled, server-side worker release endpoint or equivalent internal service.
2. Authoritative lookup of actor/organization/agent/session in one transaction.
3. Production-safe reservation schema/state transitions and expiry reconciliation, likely requiring a review-only additive migration if current columns cannot represent `releasing`, `expired` and reconciliation state.
4. A worker release client with bounded retries, fresh nonces and terminal failure handling.
5. Provider-side participant/room termination semantics and emergency-stop integration.
6. Tests for authorized release, replay, expired signatures, altered payloads, wrong tenant, wrong actor, duplicate release, cancellation, server failure, network outage, crash expiry and concurrency preservation.

## 7. Security acceptance criteria

- No release succeeds from an unsigned or body-only actor/tenant/session claim.
- A replayed or expired signature is rejected.
- A cross-tenant or cross-agent room cannot release a reservation.
- Duplicate release is safe and does not create a second audit transition.
- Failed release retains concurrency capacity until exact-row expiry/reconciliation.
- Worker cancellation, exception and emergency stop all attempt cleanup.
- Worker crash is recoverable without authorizing another session.
- Provider and microphone activation remain disabled in all offline tests.
- No token, secret, audio, transcript or customer data appears in logs.
- PostgreSQL release executes with request-local claims and server-side transaction controls.
- Independent PostgreSQL, LiveKit and privacy/security reviewers approve the production contract.

## 8. Open blockers and approval decisions

PR #49 is preparation-only and should remain draft/unmerged. The following require independent approval before implementation or activation:

1. Whether the existing authorization table is sufficient or needs an additive lifecycle-state/expiry migration.
2. The production service identity and secret-rotation policy for worker release.
3. Whether release may occur before provider termination is confirmed, or must enter reconciliation first.
4. The exact production database gateway and least-privilege role allowed to invoke the release RPC.
5. Crash-reconciliation scheduler, alert owner and maximum reservation lifetime.
6. LiveKit participant removal/room closure authority and emergency-stop behavior.
7. Provider selection, retention, microphone consent, recording policy and spend limits.

Until these decisions are approved and tested in a disposable, provider-backed environment, real voice connectivity remains NO-GO.
