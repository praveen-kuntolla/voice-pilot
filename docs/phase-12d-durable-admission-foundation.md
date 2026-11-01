# Phase 12D — Durable Admission Foundation

This phase adds a typed, fail-closed contract for the future browser LiveKit admission gateway. It does not enable LiveKit, issue tokens, create rooms, request microphones, contact providers, or connect to PostgreSQL.

`src/lib/durable-browser-admission.ts` binds organization, agent, actor, session, assertion, room, participant identity and an active reservation into one server-returned record. `authorizeDurableBrowserSession()` accepts only an injected authoritative gateway; it rejects missing gateways, malformed requests, tenant/agent/session/assertion/room/participant mismatches, missing reservations and expired records.

The browser token route now refuses admission until a reviewed durable gateway is actually wired. Environment flags cannot turn this safeguard on. Redis room authorization alone cannot satisfy durable admission.

The production gateway must adapt the existing PostgreSQL routines in `src/lib/postgres-voice-session-gateway.ts` and migrations `202610220017`/`202610220018`, while atomically connecting provider/concurrency reservation state from migrations `202610220012`–`202610220019`. It must preserve request-local actor and organization claims, emergency-stop checks, usage limits, expiry reconciliation and idempotent release. The current disposable-only PostgreSQL guard remains unchanged.

Required future work is a review-only production database adapter or additive migration for the combined admission/reservation record. It must be approved before any token route or worker runtime is enabled.
