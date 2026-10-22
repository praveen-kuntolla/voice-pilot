# Voice session security architecture (Phases 3.12–3.13, local only)

## Session issuance and worker authorization

After cookie authentication and server-side organization/agent checks, the
token endpoint generates a cryptographically random UUIDv4 session ID. The
LiveKit room is `voicepilot:<organization UUID>:<agent UUID>:<session UUID>`.
The token grants only that room, expires after five minutes, and disables
publishing and SIP permissions in connectivity mode. The authorization store
binds the full room name to organization, agent, authenticated user, session ID
and expiry. The worker signs its exact configuration request, including that
room name. The backend verifies the signature, atomic nonce use, rate limit,
agent ownership and single-use room authorization before returning the minimal
agent configuration and authorized browser identity. The worker checks the
tenant and session again before joining. Arbitrary room names or participant
metadata do not authorize configuration retrieval.

The room authorization remains as a consumed tombstone until its TTL expires;
the same room cannot be registered again during that window. Once connected,
the worker stops when the authorized browser departs, on room loss, or when
the session expires. Cleanup is idempotent and bounded. A self-contained
LiveKit JWT may still be reused to rejoin the **same** room until token expiry;
one-time room authorization does not revoke an already-issued JWT. Production
needs a deliberate token-revocation/room-lifecycle policy.

## Atomic store boundary

`VoiceSecurityStore` defines room reservation/consumption, nonce consumption
and rate limiting. The local implementation is a single-process test aid.
`RedisVoiceSecurityStore` uses `SET NX PX` for room/nonce reservation and Lua
transactions for single-use room consumption, revocation, and rate increments
with TTL. `redis-security-client.ts` uses official node-redis 6.3.0 with
bounded connection/command waits and the offline queue disabled. A failed
connection or command throws; API routes deny instead of falling back to
memory. Local development permits only a loopback `redis://` URL. Production
requires an explicit `VOICE_SECURITY_STORE=redis`, a `rediss://` URL, and a
private namespaced key prefix; otherwise the security boundary remains
disabled. Production TLS, ACLs, high availability and secret-manager wiring
have **not** been exercised in this phase.

### Disposable local Redis verification

Docker Engine 29.9.1 ran official `redis:8.10.2-alpine` as
`voicepilot-ai-redis-test`, bound only to `127.0.0.1:16379`, with persistence
disabled. The host binding was inspected and Redis returned PONG. The real
Redis integration suite tested concurrent nonce use, room reservation and
single-use consumption across independent clients, wrong-tenant denial,
revocation, shared rate limits, expiry, a process exiting without closing its
client, and client reconnection. Pausing this **dedicated** container showed
that connection acquisition and commands on an already-connected client time
out and fail closed; unpausing restored operation. The first outage attempt
exposed an unbounded handshake wait, which was fixed and retested. No remote
Redis endpoint was used.

For repeatable local setup, first ensure port 16379 and the dedicated name are
unused, then run the following in a local PowerShell terminal if needed:

```powershell
docker run --rm -d --name voicepilot-ai-redis-test --publish 127.0.0.1:16379:6379 --memory 128m --cpus 1 --restart no redis:8.10.2-alpine redis-server --save '' --appendonly no
docker inspect --format '{{json .NetworkSettings.Ports}}' voicepilot-ai-redis-test
docker exec voicepilot-ai-redis-test redis-cli PING
```

Set `VOICE_SECURITY_STORE=redis`, `VOICE_REDIS_URL=redis://127.0.0.1:16379`,
and a project-specific `VOICE_REDIS_PREFIX` only in the local test process.
Run the guarded Vitest integration files with `VOICE_TEST_REDIS_URL` set to
that loopback URL. Stop and remove only this disposable container with
`docker stop voicepilot-ai-redis-test` (`--rm` removes it automatically).
The downloaded image may remain cached. Never run these tests against a
production Redis instance.

## Application-level session revocation

`POST /api/livekit/session/terminate` requires the authenticated user and
selected organization and atomically marks that user's exact session room
revoked in the security store. A revoked room cannot be consumed for worker
configuration or registered again while the short-lived tombstone exists.
The endpoint accepts JSON only and rejects a mismatched browser `Origin`;
the issuing user and organization are independently checked server-side.
The token endpoint does not accept a client-selected session ID, so it cannot
reissue a token for that room; a separately authorized *new* session remains
possible. The endpoint explicitly returns `livekit_jwt_revoked: false`.

Revoking application authorization **does not invalidate** a self-contained
LiveKit JWT already issued, nor does it disconnect participants already in
a room. Production termination needs an approved server-side LiveKit
participant/room removal mechanism, a clear policy for JWT reuse until its
five-minute expiry, and an active-worker revocation signal. None was called
or tested against LiveKit Cloud here.

## Offline voice runtime

`MockVoicePipeline` accepts only tenant-bound `RuntimeConfig` and mock
STT/LLM/TTS adapters. Its flow is input bytes → mock transcript → mock
response → mock output bytes, with explicit listening, transcribing, thinking,
speaking and ended/error events. Each stage has a timeout; cancellation ends
the turn; provider failures emit a generic error and allow a subsequent local
turn. It never opens a microphone, publishes audio, imports an external AI
SDK or makes a network request. This foundation is not wired to a real
LiveKit session or browser audio path.

## Deployment blockers

- Production Redis TLS/ACL/HA, secret handling, observability and failover
  verification; local Redis tests do not establish production readiness.
- LiveKit-side removal/revocation for active or replayed JWTs.
- Identity/membership revocation during a live five-minute session.
- Separately approved isolated LiveKit lifecycle retest; the prior approval
  was consumed and no new connection is authorized.
- Real STT/LLM/TTS adapters, privacy review, media consent and cost controls.
- Remote Supabase migrations 005/006 and authenticated RLS verification remain
  separately gated; none are part of this phase.
