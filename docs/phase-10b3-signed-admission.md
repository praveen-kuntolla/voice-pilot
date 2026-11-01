# Phase 10B.3 — Signed server-to-worker admission

This milestone adds an offline, cryptographically verifiable admission assertion. It does not issue a LiveKit token, join a room, request microphone permission, contact a provider, create audio, write a database record, or perform telephony.

## Signature contract

Assertions use version `1`, an explicit `keyId`, and an HMAC-SHA-256 signature encoded as exactly 64 lowercase hexadecimal characters. The signature covers a length-prefixed canonical sequence containing version, key ID, assertion ID, organization, agent, actor, session, issuance/expiry, capability, duration, usage ceilings and the disabled-provider policy.

TypeScript and Python implement the same canonicalization and verify the shared deterministic vector in `tests/fixtures/signed-admission-vector.json`. Production secrets are never committed; the vector key is synthetic test material only.

## Trust and key rotation

The server is the assertion issuer. The worker accepts only assertions verified with a configured key ID from a server-controlled key resolver. Unknown key IDs fail closed. Rotation should publish a new key ID, overlap verification only for a bounded transition window, then retire the old key. Secrets must be stored server/worker-side, never in browser bundles.

## Replay, revocation and limits

The assertion ID is intended for atomic consumption. Replay, revocation, emergency-stop, concurrency and usage checks must be evaluated before the lifecycle reaches `ACTIVE`. The current implementation exposes deterministic interfaces and state inputs but does not provide distributed durability. Production requires transactional shared storage, expiry cleanup and worker-visible revocation.

## Cancellation and cleanup

Cancellation must revoke or release the assertion, stop the lifecycle and prevent terminal sessions from restarting. Existing LiveKit JWTs remain a separate revocation problem. No real token or room path is enabled here.

## Threat model

The browser, network payload and unverified worker input are untrusted. Tampering, unknown keys, malformed serialization, clock expiry, tenant mismatch, replay, revocation, emergency stop and unavailable policy state are rejected. HMAC protects integrity and authenticity only where the worker has the correct server-controlled secret; it does not replace transport security or durable authorization state.

## Production blockers

- Durable atomic replay consumption and revocation.
- Cryptographic secret storage and rotation service.
- Durable concurrency, usage and emergency-stop state.
- Provider-specific admission and webhook controls.
- LiveKit token/room integration and participant termination.
- Approved microphone, transcript and audio retention policy.

Phase 10B.4 should address a test-only signed admission endpoint and durable-state design review, still requiring explicit owner approval before external connectivity.
