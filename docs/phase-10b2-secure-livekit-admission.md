# Phase 10B.2 — Secure LiveKit admission boundary

This milestone prepares, but does not enable, LiveKit admission. No token is issued, no room is joined, no microphone permission is requested, and no provider is contacted.

## Trust boundaries

The browser is untrusted and cannot authorize itself. A future server route must authenticate the actor, resolve the selected organization from the authenticated session, verify agent ownership, and then evaluate a `SandboxAuthorizationClaims` envelope. The worker must independently validate a server-to-worker admission contract; browser-supplied claims are not sufficient.

`evaluateSandboxAdmission()` is a pure server-side boundary. `validate_worker_admission()` is an independent Python boundary. Both require organization, agent, actor and session identity, expiry, the `voice_sandbox` capability, one-session concurrency, emergency-stop clearance and provider activation disabled.

## Replay and expiry

The Phase 10B.1 process-local store provides development replay and revocation behavior. It is not a globally authoritative token revocation system. A production implementation requires a shared durable store with atomic claim, expiry, revocation, cleanup and worker-visible state.

## Token restrictions

The existing LiveKit token route remains disabled unless the existing explicit LiveKit flags and server configuration are enabled. This milestone does not change that behavior and does not add a path around it. Before a future token is issued, the envelope must be checked before room creation and the session ID must be bound to room claims and worker admission.

## Lifecycle and emergency stop

Admission must precede the Phase 9 lifecycle transition to `AUTHORIZED`/`ACTIVE`. Emergency-stop, expiry, revocation, tenant mismatch, replay and concurrency failure must prevent activation. Cancellation must revoke or release local state and leave the lifecycle terminal. Existing JWTs are not globally revoked by this offline code.

## Known limitations

- No cryptographic server-to-worker signature is implemented in this offline milestone.
- No cross-process replay or revocation store exists.
- No LiveKit token, room, provider adapter or browser audio path is active.
- No durable usage or concurrency accounting is added.

## Phase 10B.3 requirements

The next milestone may implement a signed server-to-worker admission assertion using a server-only secret or asymmetric key, with a durable replay store and a test-only LiveKit token route. It still requires explicit owner approval before any external connection, microphone access, provider credential or room join.
