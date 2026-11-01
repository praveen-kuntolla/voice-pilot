# Phase 10B.1 — Sandbox authorization envelope

This milestone adds a local-only authorization envelope for a future browser voice sandbox. It does not issue a LiveKit token, connect to a room, request microphone access, call an AI provider, create audio, write to a database, or perform telephony.

## Claims

`SandboxAuthorizationClaims` is a bounded Zod-validated object containing:

- organization, agent and authenticated actor IDs;
- UUID session ID and finite issuance/expiry timestamps;
- the only permitted capability, `voice_sandbox`;
- a maximum duration of 1–300 seconds;
- concurrency fixed to one session;
- bounded input/output character limits;
- provider activation explicitly set to `false`;
- emergency-stop explicitly set to `false`.

The envelope is tenant-bound. Authorization rechecks organization, agent, actor, expiry, revocation and emergency stop before usage is consumed.

## Replay, expiry and cleanup

`MemorySandboxAuthorizationStore` atomically claims a session ID within the process, rejects reuse, supports revocation, enforces usage caps, and removes state on cleanup. This is development/test protection only. It is not globally shared, durable, or sufficient for production JWT revocation or replay prevention. Production requires a transactional distributed store with expiry, atomic claim, revocation and cleanup semantics.

An expired, revoked, mismatched, emergency-stopped or unavailable session fails closed. No caller-supplied string can enable a provider.

## Offline integration boundary

The store is intended to be checked before constructing or starting `OfflineVoiceSandboxSession`; its `authorize` callback can be passed to the existing Phase 9 lifecycle. The existing mock session remains deterministic and provider-disabled. A future real adapter must not bypass this envelope or replace server-side authorization with browser state.

## Future LiveKit requirements

Before activation, add server-side envelope validation to token issuance and worker admission, bind short-lived room claims to the envelope session ID, enforce provider governance and spend limits, implement durable revocation, and test browser disconnect, worker failure, provider outage, emergency stop and cleanup. LiveKit JWT issuance and room joining remain disabled in this milestone.

## Rollback

Remove the feature branch, leave provider flags disabled, clear process-local authorization state, and do not issue or retain provider credentials. No migration or persistent data rollback is required.
